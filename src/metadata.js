/**
 * Carry EXIF, XMP, IPTC and ICC segments from a source JPEG into a freshly
 * encoded one. Decoding to pixels drops all of them otherwise.
 */

const EXIF = 'Exif\0\0';
const XMP = 'http://ns.adobe.com/xap/1.0/\0';
const ICC = 'ICC_PROFILE\0';
const IPTC = 'Photoshop 3.0\0';

const startsWith = ( bytes, offset, text ) =>
	[ ...text ].every( ( char, i ) => bytes[ offset + i ] === char.charCodeAt( 0 ) );

/**
 * @param {Uint8Array} bytes Source file.
 * @return {{exif: ?Uint8Array, xmp: ?Uint8Array, iptc: ?Uint8Array, icc: Uint8Array[]}}
 *         Whole segments, marker and length included.
 */
export function readJpegMetadata( bytes ) {
	const found = { exif: null, xmp: null, iptc: null, icc: [] };
	if ( bytes[ 0 ] !== 0xff || bytes[ 1 ] !== 0xd8 ) {
		return found;
	}

	let offset = 2;
	while ( offset + 4 <= bytes.length && bytes[ offset ] === 0xff ) {
		const marker = bytes[ offset + 1 ];
		if ( marker === 0xda || marker === 0xd9 ) {
			break; // Image data starts; no metadata after this.
		}
		const length = ( bytes[ offset + 2 ] << 8 ) | bytes[ offset + 3 ];
		const segment = bytes.slice( offset, offset + 2 + length );
		const body = offset + 4;

		if ( marker === 0xe1 && startsWith( bytes, body, EXIF ) ) {
			found.exif = resetOrientation( segment );
		} else if ( marker === 0xe1 && startsWith( bytes, body, XMP ) ) {
			found.xmp = segment;
		} else if ( marker === 0xe2 && startsWith( bytes, body, ICC ) ) {
			found.icc.push( segment );
		} else if ( marker === 0xed && startsWith( bytes, body, IPTC ) ) {
			found.iptc = segment;
		}
		offset += 2 + length;
	}
	return found;
}

// The browser already rotated the pixels upright, so the copied EXIF must not
// ask for another rotation.
function resetOrientation( segment ) {
	try {
		const view = new DataView( segment.buffer, segment.byteOffset, segment.byteLength );
		const tiff = 4 + EXIF.length;
		const little = view.getUint16( tiff ) === 0x4949;
		const ifd = tiff + view.getUint32( tiff + 4, little );
		const entries = view.getUint16( ifd, little );
		for ( let n = 0; n < entries; n++ ) {
			const entry = ifd + 2 + n * 12;
			if ( view.getUint16( entry, little ) === 0x0112 ) {
				view.setUint16( entry + 8, 1, little );
			}
		}
		return segment;
	} catch {
		return null; // Malformed EXIF: better dropped than copied.
	}
}

/**
 * Insert segments right after SOI and the encoder's JFIF header.
 *
 * @param {ArrayBuffer}  jpeg     Encoded JPEG.
 * @param {Uint8Array[]} segments Segments to insert, in order.
 * @return {ArrayBuffer}
 */
export function insertJpegSegments( jpeg, segments ) {
	if ( ! segments.length ) {
		return jpeg;
	}
	const bytes = new Uint8Array( jpeg );
	let at = 2;
	if ( bytes[ 2 ] === 0xff && bytes[ 3 ] === 0xe0 ) {
		at = 4 + ( ( bytes[ 4 ] << 8 ) | bytes[ 5 ] );
	}

	const out = new Uint8Array( bytes.length + segments.reduce( ( sum, segment ) => sum + segment.length, 0 ) );
	out.set( bytes.subarray( 0, at ) );
	let position = at;
	for ( const segment of segments ) {
		out.set( segment, position );
		position += segment.length;
	}
	out.set( bytes.subarray( at ), position );
	return out.buffer;
}
