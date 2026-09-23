import ExpoModulesCore
import Photos
import UIKit

/**
 * iOS port of the Android `ThumbnailSignaturesModule` (Kotlin).
 *
 * Accepts an array of media-library asset URIs, generates a 128 px thumbnail for each one
 * without loading the full-resolution source image, reduces each thumbnail to a 32×32
 * grayscale luminance matrix, and computes a 64-bit DCT perceptual hash (pHash) using the
 * same algorithm as the Android module so hashes are comparable across platforms.
 *
 * Supported URI schemes
 * ─────────────────────
 *   ph://   — iOS Photo Library asset (resolved via PHImageManager)
 *   file:// — on-disk file (resolved via UIImage + UIGraphicsImageRenderer downsample)
 *   /…      — bare absolute path (treated identically to file://)
 *
 * Return shape per URI (matches the Android module and the TypeScript NativeThumbnailSignature type)
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 *   Success: { uri, pHash, grayscale, histogram }
 *   Error:   { uri, error }
 */
public class ThumbnailSignaturesModule: Module {

  // MARK: - Pre-computed cosine lookup table
  //
  // COS_TABLE[u][x] = cos((2x + 1) * u * π / 64.0)  for u ∈ [0, 8), x ∈ [0, 32)
  //
  // Identical to the Kotlin companion object:
  //   val COS_TABLE = Array(8) { u -> DoubleArray(32) { x -> cos((2*x+1)*u*Math.PI/64.0) } }
  //
  // Computed once at class load, never reallocated.
  private static let cosTable: [[Double]] = (0 ..< 8).map { u in
    (0 ..< 32).map { x in
      cos(Double(2 * x + 1) * Double(u) * .pi / 64.0)
    }
  }

  // MARK: - Expo module definition

  public func definition() -> ModuleDefinition {
    Name("ThumbnailSignatures")

    // Accepts the same `uris: string[]` argument as the Android AsyncFunction.
    // All URIs are processed concurrently on the global background queue (mirrors
    // Kotlin's `async(Dispatchers.IO)` + `runBlocking`).
    AsyncFunction("getPhotoSignatures") { (uris: [String], promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        let group = DispatchGroup()
        // Fixed-size array preserves input order; lock guards concurrent writes.
        var results = [[String: Any]?](repeating: nil, count: uris.count)
        let lock = NSLock()

        for (index, uri) in uris.enumerated() {
          group.enter()
          DispatchQueue.global(qos: .userInitiated).async {
            let entry = Self.processURI(uri)
            lock.lock()
            results[index] = entry
            lock.unlock()
            group.leave()
          }
        }

        group.wait()
        promise.resolve(results.compactMap { $0 })
      }
    }
  }

  // MARK: - Per-URI orchestration

  private static func processURI(_ uri: String) -> [String: Any] {
    guard let thumbnail = loadThumbnail(from: uri) else {
      return ["uri": uri, "error": "Failed to decode thumbnail"]
    }
    return createSignature(uri: uri, image: thumbnail)
  }

  // MARK: - Thumbnail loading

  private static func loadThumbnail(from uri: String) -> UIImage? {
    if uri.hasPrefix("ph://") {
      // Photo Library asset — fast, low-memory thumbnail via PHImageManager.
      return loadPHAssetThumbnail(localIdentifier: String(uri.dropFirst("ph://".count)))
    }

    // file:// or bare absolute path
    let path = uri.hasPrefix("file://") ? String(uri.dropFirst("file://".count)) : uri
    return loadFileThumbnail(at: path)
  }

  /**
   * Loads a 128 px thumbnail from the iOS Photo Library.
   *
   * `isSynchronous = true` is safe here because this runs on a background queue, not the main
   * thread. `deliveryMode = .fastFormat` + `resizeMode = .fast` mirrors Android's
   * `ContentResolver.loadThumbnail(uri, Size(128, 128), null)` — both return the nearest
   * cached thumbnail rather than decoding the full-resolution source.
   *
   * `isNetworkAccessAllowed = false` skips iCloud-only assets; the TypeScript caller falls
   * back to `normalizedPhotoFingerprint` for any URI that returns an error entry.
   */
  private static func loadPHAssetThumbnail(localIdentifier: String) -> UIImage? {
    let fetchResult = PHAsset.fetchAssets(withLocalIdentifiers: [localIdentifier], options: nil)
    guard let asset = fetchResult.firstObject else { return nil }

    var thumbnail: UIImage?
    let options = PHImageRequestOptions()
    options.isSynchronous = true
    options.resizeMode = .fast
    options.deliveryMode = .fastFormat
    options.isNetworkAccessAllowed = false

    PHImageManager.default().requestImage(
      for: asset,
      targetSize: CGSize(width: 128, height: 128),
      contentMode: .aspectFill,
      options: options
    ) { image, _ in
      thumbnail = image
    }
    return thumbnail
  }

  /**
   * Loads and downsamples a file-system image to 128×128.
   *
   * Mirrors Android's `BitmapFactory.decodeFile(path, Options().apply { inSampleSize = 8 })`.
   * UIGraphicsImageRenderer is hardware-accelerated on A-series chips.
   */
  private static func loadFileThumbnail(at path: String) -> UIImage? {
    guard let source = UIImage(contentsOfFile: path) else { return nil }
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: 128, height: 128))
    return renderer.image { _ in
      source.draw(in: CGRect(x: 0, y: 0, width: 128, height: 128))
    }
  }

  // MARK: - Signature creation (mirrors Kotlin `createSignature` exactly)

  /**
   * Converts a thumbnail to the compact signature payload returned to JavaScript.
   *
   * Steps match the Kotlin implementation:
   *   1. Shrink to 32×32 (the DCT input matrix size).
   *   2. Rasterise into an RGBA byte buffer via CoreGraphics.
   *   3. Convert to grayscale luminance using BT.601 weights.
   *   4. Build a 16-bucket histogram.
   *   5. Compute the 64-bit DCT pHash.
   *   6. Base64-encode the raw luminance bytes (1 KiB — no thumbnail image crosses the bridge).
   */
  private static func createSignature(uri: String, image: UIImage) -> [String: Any] {
    // 1. Downsample to 32×32 — the DCT coefficient matrix size
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: 32, height: 32))
    let small = renderer.image { _ in
      image.draw(in: CGRect(x: 0, y: 0, width: 32, height: 32))
    }

    guard let cgImage = small.cgImage else {
      return ["uri": uri, "error": "Failed to rasterise 32×32 image"]
    }

    // 2. Rasterise into a flat RGBA byte buffer
    var pixelBuffer = [UInt8](repeating: 0, count: 32 * 32 * 4)
    guard let ctx = CGContext(
      data: &pixelBuffer,
      width: 32,
      height: 32,
      bitsPerComponent: 8,
      bytesPerRow: 32 * 4,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
      return ["uri": uri, "error": "Failed to create pixel buffer context"]
    }
    ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: 32, height: 32))

    // 3+4. Luminance (BT.601) + 16-bucket histogram
    //      Formula: gray = (r*299 + g*587 + b*114) / 1000  — identical to Kotlin
    var luminance = [UInt8](repeating: 0, count: 32 * 32)
    var histogram = [Int](repeating: 0, count: 16)
    for i in 0 ..< (32 * 32) {
      let r = Int(pixelBuffer[i * 4])
      let g = Int(pixelBuffer[i * 4 + 1])
      let b = Int(pixelBuffer[i * 4 + 2])
      let gray = (r * 299 + g * 587 + b * 114) / 1000
      luminance[i] = UInt8(clamping: gray)
      histogram[gray / 16] += 1
    }

    return [
      "uri": uri,
      "pHash": computePerceptualHash(luminance: luminance),
      "grayscale": Data(luminance).base64EncodedString(),   // 1 KiB raw luminance
      "histogram": histogram,
    ]
  }

  // MARK: - 64-bit DCT perceptual hash

  /**
   * Standard pHash: 2-D DCT on the 32×32 luminance matrix, keep the top-left 8×8
   * coefficients, threshold each of the 63 AC coefficients by their median.
   *
   * Identical to Kotlin `perceptualHash`:
   *   - Uses the pre-computed `COS_TABLE` to avoid live `cos()` calls.
   *   - Skips the DC coefficient at index 0.
   *   - Sorts the 63 AC coefficients and picks index [31] as the median.
   *   - Sets bit (index − 1) in the 64-bit hash when coefficient[index] > median.
   *   - Returns a zero-padded 16-character lowercase hex string.
   */
  private static func computePerceptualHash(luminance: [UInt8]) -> String {
    var coefficients = [Double](repeating: 0, count: 64)

    for vertical in 0 ..< 8 {
      let cosV = cosTable[vertical]
      for horizontal in 0 ..< 8 {
        let cosH = cosTable[horizontal]
        var sum = 0.0
        for y in 0 ..< 32 {
          let cosVy = cosV[y]
          let base = y * 32
          for x in 0 ..< 32 {
            sum += Double(luminance[base + x]) * cosH[x] * cosVy
          }
        }
        coefficients[vertical * 8 + horizontal] = sum
      }
    }

    // Median of the 63 AC coefficients (index 1..63); skip DC at index 0
    let acCoefficients = Array(coefficients.dropFirst()).sorted()
    let median = acCoefficients[31]   // 32nd of 63 = median

    var hash: UInt64 = 0
    for index in 1 ..< 64 {
      if coefficients[index] > median {
        hash |= (UInt64(1) << (index - 1))
      }
    }
    return String(format: "%016llx", hash)
  }
}
