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
 *         Random Number Generator (RNG) implementation.
 *         The default JavaScript RNG cannot be seeded, meaning that reproducing simulation
 *         results is difficult. This module implements an alternative RNG:
 *         multiply-with-carry RNG, in order to get better reproducibility.
 *
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

export class Random {
    constructor() {
        this.m_w = 123456789;
        this.m_z = 987654321;
        this.mask = 0xffffffff;
        this.set_seed = 0;
    }

    /* Seeds the RNG. Takes any integer as the seed */
    seed(i) {
        this.m_w = (123456789 + i) & this.mask;
        this.m_z = (987654321 - i) & this.mask;
        this.set_seed = i;
    }

    /* Returns number between 0 (inclusive) and 1.0 (exclusive), just like Math.random() */
    random() {
        this.m_z = (36969 * (this.m_z & 65535) + (this.m_z >> 16)) & this.mask;
        this.m_w = (18000 * (this.m_w & 65535) + (this.m_w >> 16)) & this.mask;
        let result = ((this.m_z << 16) + (this.m_w & 65535)) >>> 0;
        result /= 4294967296.0;
        return result;
    }

    /* Returns a number in the interval [a, b), drawn from the uniform distribution */
    uniform(a, b) {
        const delta = b - a;
        return this.random() * delta + a;
    }

    /* Returns a random point in the interval [I/2, I) - see RFC 6206 */
    trickle_random(interval) {
        return this.uniform(interval / 2, interval);
    }

    /* Returns a random integer in the interval [a, b), drawn from the uniform distribution */
    randint(a, b) {
        return Math.trunc(this.uniform(a, b));
    }

    /* Returns a random number from the normal distribution N(0, 1) */
    next_gaussian() {
        let u, v;
        do {
            u = this.random();
        } while (u === 0); /* Converting [0,1) to (0,1) */
        do {
            v = this.random();
        } while (v === 0); /* Converting [0,1) to (0,1) */
        /* uses the Box-Muller transform to convert uniform to Gaussian distribution */
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }
}

export const rng = new Random();
