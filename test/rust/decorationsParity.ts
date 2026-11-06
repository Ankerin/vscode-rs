/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { IntervalNode, nodeAcceptEdit } from '../../src/vs/editor/common/model/intervalTree.js';
import { IRustDecorationsModule, registerRustDecorations } from '../../src/vs/editor/common/model/rustDecorations.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { tryComputeRustGraphemeOffset } from '../../src/vs/base/common/rustUnicode.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustDecorationsModule = rust): T {
	const registration = registerRustDecorations(module);
	try { return compute(); } finally { registration.dispose(); }
}

test('Rust decoration edits preserve seeded marker affinities, collapse, forced movement, and unchanged node state', () => {
	let seed = 859;
	let calls = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const module: IRustDecorationsModule = { ...rust, decoration_accept_edit: (...args) => { calls++; return rust.decoration_accept_edit(...args); } };
	for (let trace = 0; trace < 2048; trace++) {
		const edits = Array.from({ length: 32 }, () => [random(120) - 10, random(120) - 10, random(20) - 2, random(2)]);
		const initial = [random(120), random(120)];
		const metadata = random(256);
		const run = () => {
			const node = new IntervalNode('decoration', initial[0], initial[1]);
			node.metadata = metadata;
			const snapshots = edits.map(([start, end, length, force]) => {
				nodeAcceptEdit(node, start, end, length, force !== 0);
				return [node.start, node.end];
			});
			return { snapshots, metadata: node.metadata, maxEnd: node.maxEnd, delta: node.delta, cached: [node.cachedAbsoluteStart, node.cachedAbsoluteEnd, node.cachedVersionId], range: node.range, links: [node.parent === node, node.left === node, node.right === node] };
		};
		assert.deepStrictEqual(withRust(run, module), run(), `Decoration trace ${trace}`);
	}
	assert.strictEqual(calls, 65536, 'Every supported interval-node edit uses the native kernel');
});

test('Rust decoration edits retain fractional and exceptional numbers, unsigned metadata coercion, and signed zero', () => {
	let seed = 229;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const values = [-Number.MAX_VALUE, -32, -1.5, -1, -0, 0, 0.25, 1, 4, 16.5, Number.MIN_VALUE, Number.MAX_VALUE, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
	for (let trace = 0; trace < 4096; trace++) {
		const [first, last, start, end, length, metadata] = Array.from({ length: 6 }, () => values[random(values.length)]);
		const force = trace % 2 === 0;
		const run = () => {
			const node = new IntervalNode('numeric', first, last);
			node.metadata = metadata;
			nodeAcceptEdit(node, start, end, length, force);
			return [node.start, node.end, node.metadata];
		};
		assert.deepStrictEqual(withRust(run), run(), `Decoration numeric trace ${trace}`);
	}
});

test('Rust decoration edits retain accessor side effects, original partial writes, subclass behavior, and proxy traps', () => {
	const accessorRun = () => {
		const node = new IntervalNode('accessor', 4, 8);
		const reads: string[] = [];
		let startValue = 4;
		let endValue = 8;
		Object.defineProperties(node, {
			metadata: { get: () => { reads.push('metadata'); return 32; } },
			start: { get: () => { reads.push('start'); return startValue; }, set: value => { reads.push('setStart'); startValue = value; } },
			end: { get: () => { reads.push('end'); return endValue; }, set: value => { reads.push('setEnd'); endValue = value; } }
		});
		nodeAcceptEdit(node, 3, 9, 2, false);
		return [startValue, endValue, reads];
	};
	assert.deepStrictEqual(withRust(accessorRun), accessorRun());
	const failure = new Error('Original decoration setter failure');
	const partialRun = () => {
		const node = new IntervalNode('partial', 4, 8);
		Object.defineProperty(node, 'end', { get: () => 8, set: () => { throw failure; } });
		assert.throws(() => nodeAcceptEdit(node, 2, 9, 3, true), error => error === failure);
		return node.start;
	};
	assert.strictEqual(withRust(partialRun), partialRun());
	const proxyRun = () => {
		const traps: string[] = [];
		const node = new Proxy(new IntervalNode('proxy', 4, 8), {
			get: (target, name, receiver) => { traps.push(`get:${String(name)}`); return Reflect.get(target, name, receiver); },
			set: (target, name, value, receiver) => { traps.push(`set:${String(name)}`); return Reflect.set(target, name, value, receiver); },
			getOwnPropertyDescriptor: (target, name) => { traps.push(`descriptor:${String(name)}`); return Reflect.getOwnPropertyDescriptor(target, name); }
		});
		nodeAcceptEdit(node, 4, 8, 3, false);
		return [node.start, node.end, traps];
	};
	assert.deepStrictEqual(withRust(proxyRun), proxyRun());
	class CustomNode extends IntervalNode { }
	const run = () => {
		const node = new CustomNode('subclass', 4, 8);
		nodeAcceptEdit(node, 4, 4, 2, false);
		return [node.start, node.end];
	};
	assert.deepStrictEqual(withRust(run), run());
	const coercionRun = () => {
		const node = new IntervalNode('coercion', 4, 8);
		nodeAcceptEdit(node, '4' as never, 4, 2, false);
		return [node.start, node.end];
	};
	assert.deepStrictEqual(withRust(coercionRun), coercionRun());
});

test('Rust decoration registration validates packets before mutation and rolls back all core registrations', () => {
	const node = new IntervalNode('invalid', 4, 8);
	assert.throws(() => withRust(() => nodeAcceptEdit(node, 4, 4, 2, false), { ...rust, decoration_accept_edit: () => new Float64Array(1) }), /decoration edit result/);
	assert.deepStrictEqual([node.start, node.end], [4, 8]);
	assert.throws(() => registerRustTextBuffer({ ...rust, decorations_abi_version: () => 0 }), /marker contract/);
	assert.strictEqual(tryComputeRustGraphemeOffset('a', 0, false), undefined);
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustDecorations(rust), /already registered/); } finally { registration.dispose(); }
	assert.strictEqual(tryComputeRustGraphemeOffset('a', 0, false), undefined);
});
