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
 *         Utility library: mathematical functions, address conversion etc.
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import * as log from './log.mjs';
import constants from './constants.mjs';

/* ------------------------------------- */

export function dbm_to_mw(dbm)
{
    return Math.pow(10, dbm / 10);
}

export function mw_to_dbm(mw)
{
    return 10 * Math.log10(mw);
}

/* ------------------------------------- */

export function get_distance(from_x, from_y, to_x, to_y)
{
    const dx = from_x - to_x;
    const dy = from_y - to_y;
    return Math.sqrt(dx * dx + dy * dy);
}

export function get_node_distance(n1, n2)
{
    const dx = n1.pos_x - n2.pos_x;
    const dy = n1.pos_y - n2.pos_y;
    return Math.sqrt(dx * dx + dy * dy);

}

/*---------------------------------------------------------------------------*/
/* Thomas Wang 32bit-Integer Mix Function
 *
 * Note: the outputs of this hash are not as uniform as using the simple modulo hash:
 *    A % N
 * However, it avoids the persistence property of the modulo hash, i.e. the property that
 * the group a tags belongs to is fixed.
 * With the modulo hash, if tags with ids A and B belong to the same probing group in slotframe 1,
 * they will continue to belong to the same probing group in slotframes 2, 3, 4, ... , since
 *   `A = B (mod P)` implies `A+c = B+c (mod P)`.
 * But with this more complex hash, the distribution in probing groups is going to be dependend
 * on the slotframe number, which is what we want to avoid persistent collisions.
 */
export function hash(a)
{
    a = (a ^ 61) ^ (a >> 16);
    a = (a + (a << 3)) & 0xffffffff;
    a = a ^ (a >> 4);
    a = (a * 0x27d4eb2d) & 0xffffffff;
    a = a ^ (a >> 15);

    return a & 0xffffffff;
}

/*---------------------------------------------------------------------------*/

export function assert(condition, msg, node)
{
    if (!condition) {
        log.log(log.ERROR, node, "Main", "assertion failed: " + msg);
        const trace = Error("stack trace").stack;
        for (var ss of trace.split("\n")) {
            log.log(log.ERROR, node, "Main", ss);
        }
        throw "assertion error, terminating";
    }
}

/*---------------------------------------------------------------------------*/

// Method to convert node id to its respective address in the network
export function id_to_addr(id)
{
    let addr = { u8 : new Array(constants.IEEE_ADDR_SIZE) };
    for (let i = 0; i < 8; i += 2) {
        addr.u8[i + 1] = id & 0xff;
        addr.u8[i + 0] = (id >> 8) & 0xff;
    }
    return addr;
}

export function addr_to_id(addr)
{
    if (addr == null) {
        return null;
    }

    const id = (addr.u8[6] << 8) + addr.u8[7];
    if (id >= 0xfffe) {
        if (id === 0xfffe) {
            return constants.EB_ID;
        }
        return constants.BROADCAST_ID;
    }
    return id;
}

export function addr_equal(addr1, addr2)
{
    if (!addr1 || !addr2) {
        return addr1 === addr2;
    }
    for (let i = 0; i < 8; i++) {
        if (addr1.u8[i] !== addr2.u8[i]) {
            return false;
        }
    }
    return true;
}

/*---------------------------------------------------------------------------*/

export function div_safe(a, b)
{
    return b ? a / b : 0.0;
}

/*---------------------------------------------------------------------------*/

Array.prototype.sum = Array.prototype.sum || function (){
    return this.length ? this.reduce((prev, curr) => prev + curr) : 0.0;
};

Array.prototype.avg = Array.prototype.avg || function () {
    return this.length ? this.sum() / this.length : null;
};

Array.prototype.min = Array.prototype.min || function () {
    if (!this.length) return null;
    let len = this.length;
    let result = Infinity;
    while (len--) {
        if (this[len] < result) {
            result = this[len];
        }
    }
    return result;
};

Array.prototype.max = Array.prototype.max || function () {
    if (!this.length) return null;
    let len = this.length;
    let result = -Infinity;
    while (len--) {
        if (this[len] > result) {
            result = this[len];
        }
    }
    return result;
};

Array.prototype.percentile = Array.prototype.percentile || function (percent) {
    if (!this.length) {
        return null;
    }
    this.sort();
    const k = (this.length - 1) * percent / 100.0;
    const f = Math.trunc(k);
    const c = Math.ceil(k);
    if (f === c) {
        return this[f];
    }
    const d0 = this[f] * (c - k);
    const d1 = this[c] * (k - f);
    return d0 + d1;
};

/*---------------------------------------------------------------------------*/

String.prototype.trim = String.prototype.trim || function() {
    return String(this).replace(/^\s+|\s+$/g, '');
};

/*---------------------------------------------------------------------------*/

export function get_hopseq(config_value)
{
    let result;
    if (typeof(config_value) === "string") {
        if (config_value === "TSCH_HOPPING_SEQUENCE_1_1") {
            result = constants.TSCH_HOPPING_SEQUENCE_1_1;
        } else if (config_value === "TSCH_HOPPING_SEQUENCE_2_2") {
            result = constants.TSCH_HOPPING_SEQUENCE_2_2;
        } else if (config_value === "TSCH_HOPPING_SEQUENCE_4_4") {
            result = constants.TSCH_HOPPING_SEQUENCE_4_4;
        } else if (config_value === "TSCH_HOPPING_SEQUENCE_16_16") {
            result = constants.TSCH_HOPPING_SEQUENCE_16_16;
        } else if (config_value === "TSCH_HOPPING_SEQUENCE_4_16") {
            result = constants.TSCH_HOPPING_SEQUENCE_4_16;
        } else {
            log.log(log.ERROR, null, "Main", `invalid config hopping sequence ${config_value}, using the default one`);
            result = constants.TSCH_HOPPING_SEQUENCE_4_4;
        }
    } else {
        result = config_value;
    }
    return JSON.parse(JSON.stringify(result));
}

/*---------------------------------------------------------------------------*/

export function has_nonempty_array(dict, array_name)
{
    if (!(array_name in dict)) {
        return false;
    }
    if (!("length" in dict[array_name])) {
        return false;
    }
    return dict[array_name].length > 0;
}

/*---------------------------------------------------------------------------*/

export function round_to_ms(seconds)
{
    return Math.round(seconds * 1000) /1000;
}

/*---------------------------------------------------------------------------*/

export function sleep(ms)
{
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

