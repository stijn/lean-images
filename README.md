# Lean Images

A WordPress plugin that brings a compress-or-die-style workflow into the Media
Library: pick an image, tune the encoder with a live before/after preview, and
save. All encoding runs in the browser (WebAssembly); the server only receives
the finished files.

## What it does

- **Media → Library → Compress** (list view row action, or the button in the
  attachment details) opens the editor for that image.
- Live comparison slider (Fit or 100%), file size and saving against the file
  WordPress serves now. A setting change cancels a slow encode straight away.
- Always compresses from the untouched original upload, never from an already
  compressed file.
- **Save as new image**: a new attachment in any format, with every registered
  sub-size encoded in the browser using the same settings and the exact
  dimensions WordPress would have used.
- **Replace this image**: same format, same dimensions, same file names, so
  every existing post keeps working. The previous files are backed up to
  `uploads/lean-images-backup/<id>/` and can be restored from the same screen.
  Backups are removed when the attachment is deleted.
- Settings are remembered per browser; **Reset settings** brings back the
  defaults.

WordPress never re-encodes these files with GD or Imagick, which would undo the
tuning.

## Every option

| Format | Options |
| --- | --- |
| JPEG (MozJPEG) | quality, separate colour quality, automatic or manual chroma subsampling (4:4:4, 4:2:0, ⅓, ¼), colour space (YCbCr, greyscale, RGB), progressive, quantisation table (9), trellis multipass, zero-block and table optimisation, trellis loops, smoothing, Huffman optimisation, baseline-compatible tables, background colour for transparency |
| WebP | lossless, quality, effort, near-lossless, exact transparent colours, transparency quality, sharp YUV, target size, target PSNR, image type hint, spatial noise shaping, deblocking strength/sharpness/type, auto filter, segments, entropy passes, token partitions, partition limit, preprocessing, transparency compression and filtering, JPEG size emulation, low memory |
| AVIF | lossless, quality, speed, chroma subsampling (4:2:0, 4:2:2, 4:4:4, 4:0:0), transparency quality, bit depth (8/10/12), sharp YUV, tune (auto/PSNR/SSIM), chroma delta quantisation, sharpness, denoise, tile rows/columns |
| PNG (OxiPNG) | colour reduction to a palette (2–256 colours, 11 dithering methods, 4 palette algorithms, 11 colour distance formulas), bits per channel, effort, clean transparent pixels, interlacing |
| Resizing | width/height, Lanczos3, Mitchell, Catmull-Rom, triangle, Magic Kernel (plain, Sharp 2013, Sharp 2021), premultiplied alpha, linear-light resizing |
| Metadata (JPEG source → JPEG) | ICC colour profile (keeps Display P3 etc.; every size), EXIF (orientation reset), XMP, IPTC (full size only) |

Not offered, because the browser builds cannot do them: arithmetic-coded JPEG
(not compiled into MozJPEG's WebAssembly build, and browsers cannot display
it), WebP's thread level and delta palette, and JPEG XL output (WordPress does
not accept `.jxl` uploads and most browsers cannot show it).

## Install and update from GitHub

Every `v*` tag builds `lean-images.zip` and attaches it to a GitHub release.

1. Download `lean-images.zip` from the latest release.
2. Plugins → Add New → Upload Plugin.

The plugin's `Update URI` points at this repository, so WordPress checks its
GitHub releases instead of WordPress.org. Auto-updates are always on: the
Plugins screen shows "Auto-updates enabled", and WordPress installs a new
release by itself, usually within 12 hours (WP-Cron checks twice a day).

Sites on 0.2.0 or older don't auto-update yet: install 0.3.0 once by hand,
and every later release arrives on its own.

### Updates from a private repository

GitHub only shows a private repository's releases to someone with access, so
each site needs a token:

1. GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token.
2. Repository access: **Only select repositories** → `lean-images`.
   Permissions: **Contents: Read-only**. Nothing else.
3. Add it to `wp-config.php`, above the "stop editing" line:

   ```php
   define( 'LEAN_IMAGES_GITHUB_TOKEN', 'github_pat_...' );
   ```

The token only goes to `api.github.com`, never into the plugin's files or the
download links WordPress shows. When it expires, updates stop showing up until
you add a new one. A public repository needs no token.

### Releasing

1. Bump `Version:` in `lean-images.php` (and `version` in `package.json`).
2. Commit, then tag the new version, e.g. `git tag v0.4.0 && git push --tags`.

The workflow refuses a tag that does not match the plugin header.

## Development

```bash
npm install
npm run build   # writes build/
npm run zip     # writes lean-images.zip
```

Requires WordPress 6.5+ (script modules, AVIF uploads) and a current browser.

## Licences

Plugin code: GPL-2.0-or-later. Bundled codecs (in `build/`), all open source:

| Component | Licence |
| --- | --- |
| jSquash wrappers / Squoosh codec builds | Apache-2.0 |
| MozJPEG | IJG + BSD-3-Clause + zlib |
| libwebp | BSD-3-Clause |
| libavif, libaom | BSD-2-Clause (+ AOMedia patent licence) |
| OxiPNG | MIT |
| squoosh-resize, magic-kernel | Apache-2.0 / MIT |
| image-q (colour reduction) | MIT |

Apache-2.0 is compatible with GPLv3, which "GPL-2.0-or-later" allows.
