# Roadmap

Every Lean Images release and what it added, newest first, plus what comes
next. Add each feature here when it lands, and each release before you tag it.

## Next

- Install Lean Images by hand once on each site that does not have it yet
  (aardling.com does). Later releases install themselves.
- Hear back from compress-or-die (OMCC) about the plugin. The e-mail and the
  r/CompressOrDie post went out on 31 October 2026.

## 0.3.2 (2 November 2026)

- The editor loads the original on sites whose WordPress address is stored
  as `http://`. WordPress handed the https admin an `http://` link to the
  upload, which browsers refuse to download from a secure page ("Load
  failed" in Safari, "Failed to fetch" in Chrome). The link now follows the
  admin's https.
- The original shows straight away, before the first compressed version is
  ready.
- No more stray "null" labels in the settings panel.
- Safari no longer treats a JPEG as transparent. Its colour conversion
  rounds some pixels to alpha 254, which showed a needless "Background for
  transparency" option and added an alpha channel to WebP, AVIF and PNG
  output.

## 0.3.1 (2 November 2026)

- A second copy of Lean Images, for example the "Source code" download from
  a release page, no longer crashes activation. The new copy stays idle and
  the Plugins screen names the folder to delete.
- A copy without the built editor (the source code) says so and links to
  `lean-images.zip`.
- Other plugins can apply the update filters with fewer arguments than
  WordPress does without causing a fatal error.

## 0.3.0 (2 November 2026)

- Auto-updates are always on for Lean Images. The Plugins screen shows
  "Auto-updates enabled" instead of a toggle, and WordPress installs each new
  release by itself, usually within 12 hours (WP-Cron checks twice a day).
- Other plugins keep their own auto-update setting.
- Sites on 0.2.0 or older need one manual install of 0.3.0.

## 0.2.0 (31 October 2026)

- Updates from a private repository: a fine-grained GitHub token in
  `wp-config.php` (`LEAN_IMAGES_GITHUB_TOKEN`, this repository only, Contents
  read-only) lets WordPress find and download new releases.
- The download goes through the GitHub API with the token, then follows
  GitHub's redirect to the signed file without it. The token never appears in
  download links or the plugin's files.
- WordPress shows a clear error when GitHub refuses the download, pointing at
  the token.
- The repository went public on 2 November 2026, so sites need no token now.

## 0.1.0 (31 October 2026)

The compress-or-die workflow inside the Media Library.

### Editor

- **Compress** link in the Media Library list view and a button in the
  attachment details.
- Live before/after comparison slider (Fit or 100%), with the file size and
  the saving against the file WordPress serves now.
- All encoding runs in the browser (WebAssembly). The server only receives the
  finished files.
- Always compresses from the untouched original upload.
- A setting change cancels a slow encode straight away.
- Settings are remembered per browser; **Reset settings** brings back the
  defaults.

### Codecs, with every option the browser builds support

- JPEG (MozJPEG), WebP, AVIF and PNG (OxiPNG), from the same WebAssembly builds
  compress-or-die uses.
- PNG colour reduction to a palette (image-q), with dithering, palette
  algorithms and colour distance formulas.
- Resizing with Lanczos3, Mitchell, Catmull-Rom, triangle and three Magic
  Kernel variants, premultiplied alpha and linear-light resizing.
- JPEG metadata kept from a JPEG source: ICC colour profile (Display P3 stays
  Display P3), EXIF with the orientation reset, XMP and IPTC.

### Saving

- **Save as new image** in any format, with every registered sub-size encoded
  in the browser at the exact dimensions WordPress would use.
- **Replace this image** keeps the format, dimensions and file names, so
  existing posts keep working. The old files go to
  `uploads/lean-images-backup/<id>/` and restore from the same screen. Deleting
  the attachment deletes its backup.
- WordPress never re-encodes these files with GD or Imagick.

### Distribution

- A GitHub Actions workflow builds `lean-images.zip` for every `v*` tag and
  attaches it to a GitHub release. It refuses a tag that does not match the
  plugin header.
- The `Update URI` header makes WordPress check GitHub releases instead of
  WordPress.org.

## Not planned

The browser builds cannot do these, so Lean Images leaves them out:

- Arithmetic-coded JPEG: not compiled into MozJPEG's WebAssembly build, and
  browsers cannot display it.
- WebP's thread level and delta palette.
- JPEG XL output: WordPress does not accept `.jxl` uploads and most browsers
  cannot show it.
