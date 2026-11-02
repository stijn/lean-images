<?php
/**
 * Plugin Name:       Lean Images
 * Description:       Compress images in your browser with MozJPEG, WebP, AVIF and OxiPNG (WebAssembly), with a live before/after preview. Nothing is sent to a third party.
 * Version:           0.3.0
 * Requires at least: 6.5
 * Requires PHP:      7.4
 * Author:            Stijn Vogels
 * Plugin URI:        https://github.com/stijn/lean-images
 * Update URI:        https://github.com/stijn/lean-images
 * License:           GPL-2.0-or-later
 * Text Domain:       lean-images
 *
 * @package LeanImages
 */

defined( 'ABSPATH' ) || exit;

define( 'LEAN_IMAGES_VERSION', '0.3.0' );
define( 'LEAN_IMAGES_FILE', __FILE__ );

require __DIR__ . '/includes/files.php';
require __DIR__ . '/includes/admin.php';
require __DIR__ . '/includes/rest.php';
require __DIR__ . '/includes/updater.php';
