<?php
/**
 * Updates from GitHub releases.
 *
 * The plugin header's "Update URI" points at github.com, so WordPress asks the
 * update_plugins_github.com filter instead of WordPress.org. Each release must
 * carry a lean-images.zip asset (the release workflow builds it). WordPress
 * installs new releases by itself, like other auto-updated plugins.
 *
 * A private repository only answers with a token, set in wp-config.php:
 *
 *     define( 'LEAN_IMAGES_GITHUB_TOKEN', 'github_pat_...' );
 *
 * A fine-grained token for this repository alone, with read-only "Contents"
 * access, is enough. Without a token a private repository finds nothing and
 * WordPress simply reports no update.
 *
 * @package LeanImages
 */

defined( 'ABSPATH' ) || exit;

const LEAN_IMAGES_REPOSITORY = 'stijn/lean-images';

/**
 * Whether wp-config.php holds a GitHub token.
 *
 * @return bool
 */
function lean_images_has_token() {
	return defined( 'LEAN_IMAGES_GITHUB_TOKEN' ) && '' !== (string) LEAN_IMAGES_GITHUB_TOKEN;
}

/**
 * Request headers for the GitHub API, with the token when there is one.
 *
 * @param string $accept Accept header.
 * @return array
 */
function lean_images_github_headers( $accept ) {
	$headers = array( 'Accept' => $accept );
	if ( lean_images_has_token() ) {
		$headers['Authorization'] = 'Bearer ' . LEAN_IMAGES_GITHUB_TOKEN;
	}
	return $headers;
}

/**
 * Latest release with a plugin zip, cached for a few hours.
 *
 * @return array{version: string, package: string, asset: string, url: string, notes: string}|null
 */
function lean_images_latest_release() {
	$cached = get_site_transient( 'lean_images_release' );
	if ( false !== $cached ) {
		return $cached ? $cached : null;
	}

	$response = wp_remote_get(
		'https://api.github.com/repos/' . LEAN_IMAGES_REPOSITORY . '/releases/latest',
		array(
			'timeout' => 10,
			'headers' => lean_images_github_headers( 'application/vnd.github+json' ),
		)
	);

	$release = null;
	if ( 200 === wp_remote_retrieve_response_code( $response ) ) {
		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		foreach ( isset( $data['assets'] ) ? $data['assets'] : array() as $asset ) {
			if ( 'lean-images.zip' === $asset['name'] ) {
				$release = array(
					'version' => ltrim( $data['tag_name'], 'v' ),
					'package' => $asset['browser_download_url'],
					'asset'   => $asset['url'],
					'url'     => $data['html_url'],
					'notes'   => (string) $data['body'],
				);
			}
		}
	}

	// An empty string caches "nothing found" too, so a missing token or a
	// GitHub hiccup does not trigger a request on every admin page.
	set_site_transient( 'lean_images_release', $release ? $release : '', 3 * HOUR_IN_SECONDS );
	return $release;
}

/**
 * Download URL for a release. With a token that is the API address of the
 * asset, which the upgrader_pre_download filter below knows how to fetch.
 *
 * @param array $release From lean_images_latest_release().
 * @return string
 */
function lean_images_release_package( $release ) {
	return lean_images_has_token() && ! empty( $release['asset'] ) ? $release['asset'] : $release['package'];
}

add_filter(
	'update_plugins_github.com',
	function ( $update, $plugin_data, $plugin_file ) {
		if ( plugin_basename( LEAN_IMAGES_FILE ) !== $plugin_file ) {
			return $update;
		}
		$release = lean_images_latest_release();
		if ( ! $release ) {
			return $update;
		}
		return array(
			'slug'    => 'lean-images',
			'version' => $release['version'],
			'url'     => $release['url'],
			'package' => lean_images_release_package( $release ),
		);
	},
	10,
	3
);

// Auto-update this plugin only. The Plugins screen then shows "Auto-updates
// enabled" instead of a toggle.
add_filter(
	'auto_update_plugin',
	function ( $update, $item ) {
		if ( isset( $item->plugin ) && plugin_basename( LEAN_IMAGES_FILE ) === $item->plugin ) {
			return true;
		}
		return $update;
	},
	10,
	2
);

// A private asset only downloads through the API with the token. GitHub then
// redirects to a short-lived signed address that must be fetched without the
// token, so WordPress cannot follow that redirect by itself.
add_filter(
	'upgrader_pre_download',
	function ( $reply, $package ) {
		$prefix = 'https://api.github.com/repos/' . LEAN_IMAGES_REPOSITORY . '/releases/assets/';
		if ( false !== $reply || ! is_string( $package ) || 0 !== strpos( $package, $prefix ) ) {
			return $reply;
		}

		$file     = wp_tempnam( 'lean-images.zip' );
		$response = wp_safe_remote_get(
			$package,
			array(
				'timeout'     => 300,
				'redirection' => 0,
				'stream'      => true,
				'filename'    => $file,
				'headers'     => lean_images_github_headers( 'application/octet-stream' ),
			)
		);
		$code     = (int) wp_remote_retrieve_response_code( $response );

		// GitHub may also send the file straight away.
		if ( 200 === $code ) {
			return $file;
		}
		wp_delete_file( $file );

		$location = wp_remote_retrieve_header( $response, 'location' );
		if ( $code >= 300 && $code < 400 && $location ) {
			return download_url( $location );
		}
		return new WP_Error(
			'lean_images_download',
			sprintf(
				/* translators: %d: HTTP status code. */
				__( 'GitHub refused the Lean Images download (HTTP %d). Check LEAN_IMAGES_GITHUB_TOKEN in wp-config.php.', 'lean-images' ),
				$code
			)
		);
	},
	10,
	2
);

// "View details" in the update notice.
add_filter(
	'plugins_api',
	function ( $result, $action, $args ) {
		if ( 'plugin_information' !== $action || empty( $args->slug ) || 'lean-images' !== $args->slug ) {
			return $result;
		}
		$release = lean_images_latest_release();
		if ( ! $release ) {
			return $result;
		}
		return (object) array(
			'name'          => 'Lean Images',
			'slug'          => 'lean-images',
			'version'       => $release['version'],
			'homepage'      => 'https://github.com/' . LEAN_IMAGES_REPOSITORY,
			'download_link' => lean_images_release_package( $release ),
			'sections'      => array( 'changelog' => wpautop( esc_html( $release['notes'] ) ) ),
		);
	},
	10,
	3
);

// "Check again" on Dashboard → Updates should really ask GitHub again.
add_action(
	'load-update-core.php',
	function () {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Only clears a cache.
		if ( isset( $_GET['force-check'] ) ) {
			delete_site_transient( 'lean_images_release' );
		}
	}
);
