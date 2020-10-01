/*
 * Copyright (c) 2020, Institute of Electronics and Computer Science (EDI)
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the Institute nor the names of its contributors
 *    may be used to endorse or promote products derived from this software
 *    without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE INSTITUTE AND CONTRIBUTORS ``AS IS'' AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED.  IN NO EVENT SHALL THE INSTITUTE OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
 * OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 */

/**
 * \file
 *         Heap data structure library.
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import { assert } from "./utils.mjs";

/* Insert a new element */
export function heap_insert(heap, element, less_than)
{
    let i = heap.length;
    heap.push(element);
    element.heap_position = i;
    while (i > 0) {
        const parent = Math.trunc((i - 1) / 2);
        if (less_than(heap[i], heap[parent])) {
            const t = heap[parent];
            heap[parent] = heap[i];
            heap[parent].heap_position = parent;
            heap[i] = t;
            t.heap_position = i;
            i = parent;
        } else {
            break;
        }
    }
}

/* Remove and return the minimum (root) element */
export function heap_extract_min(heap, less_than)
{
    assert(heap.length, "heap must be nonempty");
    const result = heap[0];
    result.heap_position = -1;
    heap[0] = heap[heap.length - 1];
    heap[0].heap_position = 0;
    heap.pop();
    min_heapify(heap, 0, less_than);
    return result;
}

/* Remove an element at specific position `i` */
export function heap_remove_at(heap, i, less_than)
{
    assert(i < heap.length, "nonexistent heap element");
    heap[i].heap_position = -1;
    heap[i] = heap[heap.length - 1];
    heap[i].heap_position = i;
    heap.pop();
    min_heapify(heap, i, less_than);
}

/* Restore the heap property for element at position `i` */
export function min_heapify(heap, i, less_than)
{
    const left = i * 2 + 1;
    const right = i * 2 + 2;
    let smallest = i;
    if (left < heap.length && less_than(heap[left], heap[smallest])) {
        smallest = left;
    }
    if (right < heap.length && less_than(heap[right], heap[smallest])) {
        smallest = right;
    }

    if (smallest !== i) {
        const t = heap[smallest];
        heap[smallest] = heap[i];
        heap[smallest].heap_position = smallest;
        heap[i] = t;
        t.heap_position = i;
        min_heapify(heap, smallest, less_than);
    }
}

/* Test the heap functionality */
export function test()
{
    const heap = [];
    const lt = function(a, b) { return a < b; }
    heap_insert(heap, 11, lt);
    heap_insert(heap, 5, lt);
    heap_insert(heap, 8, lt);
    heap_insert(heap, 4, lt);
    heap_insert(heap, 3, lt);

    while (heap.length) {
        console.log(heap_extract_min(heap, lt));
    }
}
