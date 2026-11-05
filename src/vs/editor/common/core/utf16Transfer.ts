/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Encodes every JavaScript UTF-16 code unit without replacing unpaired surrogates. */
export function encodeUTF16(text: string): Uint16Array {
	const units = new Uint16Array(text.length);
	for (let index = 0; index < text.length; index++) {
		units[index] = text.charCodeAt(index);
	}
	return units;
}

const utf16Decoder = new TextDecoder('utf-16le', { fatal: true, ignoreBOM: true });
const isLittleEndian = new Uint8Array(new Uint16Array([0x0102]).buffer)[0] === 0x02;

/** Decodes strings or native UTF-16 units while preserving BOM and unpaired surrogates. */
export function decodeUTF16(units: string | Uint16Array): string {
	if (typeof units === 'string') {
		return units;
	}
	if (units.length <= 64) {
		return String.fromCharCode(...units);
	}
	if (isLittleEndian) {
		try {
			return utf16Decoder.decode(new Uint8Array(units.buffer, units.byteOffset, units.byteLength));
		} catch {
			// Decode valid spans separately when lone surrogates are sparse, preserving every code unit.
			const offsets: number[] = [];
			for (let index = 0; index < units.length && offsets.length <= 1024; index++) {
				const unit = units[index];
				if (unit >= 0xD800 && unit <= 0xDBFF && units[index + 1] >= 0xDC00 && units[index + 1] <= 0xDFFF) {
					index++;
				} else if (unit >= 0xD800 && unit <= 0xDFFF) {
					offsets.push(index);
				}
			}
			if (offsets.length <= 1024) {
				const chunks: string[] = [];
				let start = 0;
				for (const offset of offsets) {
					if (offset > start) {
						chunks.push(utf16Decoder.decode(new Uint8Array(units.buffer, units.byteOffset + start * 2, (offset - start) * 2)));
					}
					chunks.push(String.fromCharCode(units[offset]));
					start = offset + 1;
				}
				if (start < units.length) {
					chunks.push(utf16Decoder.decode(new Uint8Array(units.buffer, units.byteOffset + start * 2, (units.length - start) * 2)));
				}
				return chunks.join('');
			}
		}
	}
	const chunks: string[] = [];
	for (let offset = 0; offset < units.length; offset += 8192) {
		chunks.push(String.fromCharCode(...units.subarray(offset, offset + 8192)));
	}
	return chunks.join('');
}

/** Decodes a little-endian byte span losslessly, including unaligned views and other host byte orders. */
export function decodeUTF16LELossless(bytes: Uint8Array, offset: number, length: number): string {
	if (length === 1) {
		return String.fromCharCode(bytes[offset] | bytes[offset + 1] << 8);
	}
	if (length === 2) {
		return String.fromCharCode(bytes[offset] | bytes[offset + 1] << 8, bytes[offset + 2] | bytes[offset + 3] << 8);
	}
	if (isLittleEndian && (bytes.byteOffset + offset) % 2 === 0) {
		return decodeUTF16(new Uint16Array(bytes.buffer, bytes.byteOffset + offset, length));
	}
	const units = new Uint16Array(length);
	const view = new DataView(bytes.buffer, bytes.byteOffset + offset, length * 2);
	for (let index = 0; index < units.length; index++) {
		units[index] = view.getUint16(index * 2, true);
	}
	return decodeUTF16(units);
}

