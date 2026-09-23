package com.mediawizard.thumbnailsignatures

import android.graphics.Bitmap
import android.net.Uri
import android.util.Base64
import android.util.Size
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlin.math.cos

/**
 * Loads small MediaStore thumbnails rather than opening full-resolution source images. The module
 * returns compact data only; callers never receive thumbnail files or Base64 image payloads.
 */
class ThumbnailSignaturesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ThumbnailSignatures")

    AsyncFunction("getPhotoSignatures") { uris: List<String> ->
      val resolver = requireNotNull(appContext.reactContext).contentResolver
      runBlocking {
        uris.map { uriString ->
          async(Dispatchers.IO) {
            try {
              val parsedUri = Uri.parse(uriString)
              val thumbnail = if (parsedUri.scheme == "file") {
                val options = android.graphics.BitmapFactory.Options().apply {
                  inSampleSize = 8
                }
                android.graphics.BitmapFactory.decodeFile(parsedUri.path, options)
                  ?: throw IllegalArgumentException("Could not decode file bitmap at ${parsedUri.path}")
              } else {
                resolver.loadThumbnail(parsedUri, Size(128, 128), null)
              }

              try {
                createSignature(uriString, thumbnail)
              } finally {
                thumbnail.recycle()
              }
            } catch (error: Exception) {
              mapOf("uri" to uriString, "error" to (error.message ?: error.javaClass.simpleName))
            }
          }
        }.map { it.await() }
      }
    }
  }

  private fun createSignature(uri: String, thumbnail: Bitmap): Map<String, Any> {
    val grayscale = Bitmap.createScaledBitmap(thumbnail, 32, 32, true)
    try {
      val pixels = IntArray(32 * 32)
      grayscale.getPixels(pixels, 0, 32, 0, 0, 32, 32)
      val luminance = ByteArray(32 * 32)
      val histogram = IntArray(16)

      pixels.forEachIndexed { index, pixel ->
        val red = (pixel shr 16) and 0xff
        val green = (pixel shr 8) and 0xff
        val blue = pixel and 0xff
        val gray = ((red * 299 + green * 587 + blue * 114) / 1000)
        luminance[index] = gray.toByte()
        histogram[gray / 16] += 1
      }

      return mapOf(
        "uri" to uri,
        "pHash" to perceptualHash(luminance),
        // 1 KiB for the complete 32x32 signature, rather than transferring a thumbnail image.
        "grayscale" to Base64.encodeToString(luminance, Base64.NO_WRAP),
        "histogram" to histogram.toList(),
      )
    } finally {
      if (grayscale !== thumbnail) grayscale.recycle()
    }
  }

  companion object {
    private val COS_TABLE = Array(8) { u ->
      DoubleArray(32) { x ->
        cos((2 * x + 1) * u * Math.PI / 64.0)
      }
    }
  }

  /** Standard 32x32 DCT pHash: keep the top-left 8x8 coefficients and threshold by median. */
  private fun perceptualHash(luminance: ByteArray): String {
    val coefficients = DoubleArray(64)
    for (vertical in 0 until 8) {
      val cosV = COS_TABLE[vertical]
      for (horizontal in 0 until 8) {
        val cosH = COS_TABLE[horizontal]
        var sum = 0.0
        for (y in 0 until 32) {
          val cosVy = cosV[y]
          val rowOffset = y * 32
          for (x in 0 until 32) {
            val sample = luminance[rowOffset + x].toInt() and 0xff
            sum += sample * cosH[x] * cosVy
          }
        }
        coefficients[vertical * 8 + horizontal] = sum
      }
    }

    val median = coefficients.copyOfRange(1, coefficients.size).sorted()[31]
    var hash = 0L
    for (index in 1 until coefficients.size) {
      if (coefficients[index] > median) hash = hash or (1L shl (index - 1))
    }
    return "%016x".format(hash)
  }
}
