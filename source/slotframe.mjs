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
 *         TSCH cell and slotframe classes
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import constants from './constants.mjs';
import * as log from './log.mjs';

/* ------------------------------------- */

/* An IEEE 802.15.4-2015 TSCH cell */
export class Cell {
    constructor(timeslot, channel_offset, slotframe, options) {
        this.timeslot = timeslot;
        this.channel_offset = channel_offset;
        this.slotframe = slotframe;
        this.options = options;
        this.type = constants.CELL_TYPE_NORMAL;
        this.neighbor_id = constants.BROADCAST_ID;
        this.action = null;
    }

    is_tx() {
        return this.options & constants.CELL_OPTION_TX;
    }

    is_rx() {
        return this.options & constants.CELL_OPTION_RX;
    }

    is_shared() {
        return this.options & constants.CELL_OPTION_SHARED;
    }

    is_dedicated() {
        return this.neighbor_id !== constants.BROADCAST_ID;
    }

    optionstring() {
        let result = "";
        if (this.is_tx()) result += "Tx";
        if (this.is_rx()) result += "Rx";
        return result;
    }

    str() {
        return `timeslot=${this.timeslot} choffset=${this.channel_offset} slotframe=${this.slotframe.handle} options=${this.optionstring()} neighbor=${this.neighbor_id}`
    }
}

/* ------------------------------------- */

/** 802.15.4e slotframe (contains cells) */
export class Slotframe {
    constructor(node, handle, rule_name, size) {
        this.node = node;
        this.handle = handle;
        this.rule_name = rule_name;
        this.size = size;
        this.cells = [];
    }

    /* This function works similarly as `tsch_schedule_add_link` in the Contiki-NG code */
    add_cell(options, type, neighbor_id, timeslot, channel_offset, keep_old) {

        // Channel offset and channel number is the same
        /* validate arguments */
        if (timeslot >= this.size) {
            log.log(log.ERROR, this.node, "Node", `add cell: too large timeslot=${timeslot}`);
            return null;
        }

        if (!keep_old) {
            /* remove old cells at this timeslot and offset */
            this.remove_cell_by_timeslot_and_co(timeslot, channel_offset);
        }

        var cell = new Cell(timeslot, channel_offset, this, options);
        this.cells.push(cell);
        cell.type = type;
        cell.neighbor_id = neighbor_id;

        log.log(log.DEBUG, this.node, "TSCH", `added cell timeslot=${timeslot} choffset=${channel_offset} options=${cell.optionstring()} slotframe=${this.handle}`);
        return cell;
    }

    str() {
        let s = `size=${this.size}\n`;
        for (let c of this.cells) {
            s += "  cell " + c.str() + "\n";
        }
        return s;
    }

    get_cell(timeslot, channel_offset) {
        for (let c of this.cells) {
            if (c.timeslot === timeslot && c.channel_offset === channel_offset) {
                return c;
            }
        }
        return null;
    }

    remove_cell_by_timeslot(timeslot) {
        const old_num_cells = this.cells.length;
        this.cells = this.cells.filter(function (cell) { return cell.timeslot !== timeslot; });
        return old_num_cells !== this.cells.length;
    }

    remove_cell_by_timeslot_and_co(timeslot, channel_offset) {
        const old_num_cells = this.cells.length;
        this.cells = this.cells.filter(function (cell) {
            return cell.timeslot !== timeslot || cell.channel_offset !== channel_offset;
        });
        return old_num_cells !== this.cells.length;
    }

    remove_cell_by_timeslot_co_and_options(timeslot, channel_offset, options) {
        const old_num_cells = this.cells.length;
        this.cells = this.cells.filter(function (cell) {
            return cell.timeslot !== timeslot || cell.channel_offset !== channel_offset || cell.options !== options;
        });
        return old_num_cells !== this.cells.length;
    }
}

/* ------------------------------------- */

/* Returns the cell that should be preferred from the two given cells `a` and `b`.
 * Used in case there are multiple cells at the same slotframe scheduled at the same timeslot. */
export function select_best_tsch_cell(node, a, b)
{
    if (a.slotframe.handle !== b.slotframe.handle) {
        /* prioritize by lower slotframe */
        return a.slotframe.handle < b.slotframe.handle ? a : b;
    }

    if (!(a.options & constants.CELL_OPTION_TX)) {
        /* none of the cells are Tx: simply return the first cell */
        return a;
    }

    /* prioritize by number of packets, keep `a` in case equal */
    if (a.neighbor_id === b.neighbor_id) {
        /* fast path */
        return a;
    }
    
    const num_packets_a = node.neighbors.get(a.neighbor_id).get_queue_size();
    const num_packets_b = node.neighbors.get(b.neighbor_id).get_queue_size();
    return num_packets_a >= num_packets_b ? a : b;
}
