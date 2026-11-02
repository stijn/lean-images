/**
 * Codec worker: decodes the original once, then crops, resizes and encodes on
 * request. Codecs are imported lazily so only the chosen format's .wasm loads.
 */
import resize from '@jsquash/resize';
import { readJpegMetadata, insertJpegSegments } from './metadata.js';

const encoders = {
	'image/jpeg': async ( image, options, extra ) => {
		const { default: encode } = await import( '@jsquash/jpeg/encode' );
		const jpeg = await encode( flatten( image, extra.background ), options );
		return insertJpegSegments( jpeg, metadataSegments( extra.metadata ) );
	},
	'image/webp': async ( image, options ) => {
		const { default: encode } = await import( '@jsquash/webp/encode' );
		return encode( image, options );
	},
	'image/avif': async ( image, options ) => {
		const { default: encode } = await import( '@jsquash/avif/encode' );
		return encode( options.bitDepth > 8 ? toHighBitDepth( image, options.bitDepth ) : image, options );
	},
	'image/png': async ( image, { posterize, quantize, ...options } ) => {
		const { default: optimise } = await import( '@jsquash/oxipng/optimise' );
		let pixels = posterize < 8 ? posterizeImage( image, posterize ) : image;
		if ( quantize ) {
			pixels = await quantizeImage( pixels, quantize );
		}
		return optimise( pixels, options );
	},
};

let blob = null;
let metadata = null;
let sources = {};
let prepared = { key: '', image: null };

async function load( url ) {
	const response = await fetch( url, { credentials: 'same-origin' } );
	if ( ! response.ok ) {
		throw new Error( `Could not load the original image (HTTP ${ response.status }).` );
	}
	blob = await response.blob();
	metadata = readJpegMetadata( new Uint8Array( await blob.arrayBuffer() ) );
	sources = {};
	prepared = { key: '', image: null };

	const source = await decode( 'srgb' );
	return {
		width: source.width,
		height: source.height,
		bytes: blob.size,
		hasAlpha: hasAlpha( source ),
		metadata: {
			icc: metadata.icc.length > 0,
			exif: Boolean( metadata.exif ),
			xmp: Boolean( metadata.xmp ),
			iptc: Boolean( metadata.iptc ),
		},
	};
}

// "srgb" lets the browser convert to sRGB (right when the profile is
// dropped); "raw" keeps the pixels in the source's own colour space, for
// re-embedding its ICC profile.
async function decode( space ) {
	if ( ! sources[ space ] ) {
		const bitmap = await createImageBitmap( blob, {
			colorSpaceConversion: space === 'raw' ? 'none' : 'default',
			premultiplyAlpha: 'none',
		} );
		const canvas = new OffscreenCanvas( bitmap.width, bitmap.height );
		const context = canvas.getContext( '2d' );
		context.drawImage( bitmap, 0, 0 );
		bitmap.close();
		sources[ space ] = context.getImageData( 0, 0, canvas.width, canvas.height );
		// A JPEG has no alpha channel, but Safari's colour conversion rounds
		// some pixels to alpha 254. Left alone, that adds a needless alpha
		// channel to WebP, AVIF and PNG output.
		if ( blob.type === 'image/jpeg' ) {
			makeOpaque( sources[ space ].data );
		}
	}
	return sources[ space ];
}

function makeOpaque( data ) {
	for ( let i = 3; i < data.length; i += 4 ) {
		data[ i ] = 255;
	}
}

// Preview re-encodes at the same dimensions on every settings change, so the
// last cropped/resized bitmap is kept around.
async function prepare( { width, height, crop, resizeOptions, space } ) {
	const key = JSON.stringify( [ width, height, crop, resizeOptions, space ] );
	if ( prepared.key === key ) {
		return prepared.image;
	}

	const source = await decode( space );
	let image = crop ? cropImage( source, crop ) : source;
	if ( image.width !== width || image.height !== height ) {
		image = await resize( image, { ...resizeOptions, width, height } );
	}
	prepared = { key, image };
	return image;
}

async function encode( { mime, options, width, height, crop, resizeOptions, background, keep = {} } ) {
	if ( ! blob ) {
		throw new Error( 'No image loaded.' );
	}
	const encoder = encoders[ mime ];
	if ( ! encoder ) {
		throw new Error( `Unsupported format: ${ mime }` );
	}
	// Only JPEG output can carry the source's metadata.
	const kept = mime === 'image/jpeg' ? keep : {};
	const space = kept.icc && metadata.icc.length ? 'raw' : 'srgb';
	const started = performance.now();
	const image = await prepare( { width, height, crop, resizeOptions, space } );
	const buffer = await encoder( image, options, { background, metadata: kept } );
	return { buffer, ms: Math.round( performance.now() - started ) };
}

function metadataSegments( keep = {} ) {
	return [
		keep.exif && metadata.exif,
		keep.xmp && metadata.xmp,
		...( keep.icc ? metadata.icc : [] ),
		keep.iptc && metadata.iptc,
	].filter( Boolean );
}

function cropImage( image, { x, y, w, h } ) {
	x = Math.max( 0, Math.min( x, image.width - 1 ) );
	y = Math.max( 0, Math.min( y, image.height - 1 ) );
	w = Math.min( w, image.width - x );
	h = Math.min( h, image.height - y );

	const out = new ImageData( w, h );
	for ( let row = 0; row < h; row++ ) {
		const start = ( ( y + row ) * image.width + x ) * 4;
		out.data.set( image.data.subarray( start, start + w * 4 ), row * w * 4 );
	}
	return out;
}

function hasAlpha( image ) {
	const data = image.data;
	for ( let i = 3; i < data.length; i += 4 ) {
		if ( data[ i ] !== 255 ) {
			return true;
		}
	}
	return false;
}

// JPEG has no alpha channel: composite transparent pixels onto the chosen
// background instead of letting them turn black.
function flatten( image, background = '#ffffff' ) {
	if ( ! hasAlpha( image ) ) {
		return image;
	}
	const bg = [ 1, 3, 5 ].map( ( i ) => parseInt( background.slice( i, i + 2 ), 16 ) || 0 );
	const out = new ImageData( image.width, image.height );
	const src = image.data;
	const dst = out.data;
	for ( let i = 0; i < src.length; i += 4 ) {
		const alpha = src[ i + 3 ] / 255;
		dst[ i ] = src[ i ] * alpha + bg[ 0 ] * ( 1 - alpha );
		dst[ i + 1 ] = src[ i + 1 ] * alpha + bg[ 1 ] * ( 1 - alpha );
		dst[ i + 2 ] = src[ i + 2 ] * alpha + bg[ 2 ] * ( 1 - alpha );
		dst[ i + 3 ] = 255;
	}
	return out;
}

function toHighBitDepth( image, bitDepth ) {
	const max = 2 ** bitDepth - 1;
	const data = new Uint16Array( image.data.length );
	for ( let i = 0; i < data.length; i++ ) {
		data[ i ] = Math.round( ( image.data[ i ] * max ) / 255 );
	}
	return { data, width: image.width, height: image.height };
}

// Colour channels only: posterized alpha gives jagged edges.
function posterizeImage( image, bits ) {
	const levels = 2 ** bits - 1;
	const out = new ImageData( new Uint8ClampedArray( image.data ), image.width, image.height );
	for ( let i = 0; i < out.data.length; i++ ) {
		if ( i % 4 !== 3 ) {
			out.data[ i ] = Math.round( ( Math.round( ( out.data[ i ] * levels ) / 255 ) * 255 ) / levels );
		}
	}
	return out;
}

async function quantizeImage( image, { colors, imageQuantization, paletteQuantization, colorDistanceFormula } ) {
	const { buildPaletteSync, applyPaletteSync, utils } = await import( 'image-q' );
	const points = utils.PointContainer.fromUint8Array( image.data, image.width, image.height );
	const palette = buildPaletteSync( [ points ], { colors, paletteQuantization, colorDistanceFormula } );
	const result = applyPaletteSync( points, palette, { imageQuantization, colorDistanceFormula } );
	return new ImageData( new Uint8ClampedArray( result.toUint8Array() ), image.width, image.height );
}

const handlers = { load: ( message ) => load( message.url ), encode };

// Handle one message at a time: codecs are single-threaded and the prepared
// bitmap cache must not be swapped out mid-encode.
let queue = Promise.resolve();
self.onmessage = ( { data } ) => {
	queue = queue.then( async () => {
		try {
			const result = await handlers[ data.type ]( data );
			self.postMessage( { id: data.id, result }, result.buffer ? [ result.buffer ] : [] );
		} catch ( error ) {
			self.postMessage( { id: data.id, error: error?.message || String( error ) } );
		}
	} );
};
