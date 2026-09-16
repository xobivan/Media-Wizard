# MediaWizard Developer Documentation

This directory contains the technical documentation for MediaWizard.

## Guides

- [General Architecture](./GENERAL_ARCHITECTURE.md)
  - Application structure
  - Screen workflow
  - Hook responsibilities
  - State ownership and data flow
- [Scanning and Duplicate Detection](./SCAN_AND_DUPLICATE_DETECTION.md)
  - Scan lifecycle
  - Fast and deep scan modes
  - Photo duplicate matching
  - Video duplicate matching
  - Duplicate deletion
- [Compression](./COMPRESSION.md)
  - Large-video detection
  - Compression planning
  - Storage strategy
  - Sequential compression
  - Output verification
  - Cancellation and original deletion
- [Maintenance Guide](./MAINTENANCE.md)
  - Where to make changes
  - Error and fallback behavior
  - Architectural boundaries
  - Important implementation constraints

## Application purpose

MediaWizard is an on-device media cleanup app. It finds duplicate photos and
videos, identifies large videos with useful compression potential, compresses
selected videos, and optionally deletes originals after verification.

Media files are processed locally and are not uploaded to a server.
