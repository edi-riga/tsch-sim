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
 *         TSCH / IPv6 neighbor
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import constants from './constants.mjs';
import config from "./config.mjs";
import * as log from './log.mjs';
import * as time from './time.mjs';
import * as simulator from './simulator.mjs';

/* EWMA (exponential moving average) used to maintain statistics over time */
const EWMA_ALPHA = 0.1;
const EWMA_BOOTSTRAP_ALPHA = 0.25;

/* ETX fixed point divisor. 128 is the value used by RPL (RFC 6551 and RFC 6719) */
export const ETX_DIVISOR          = 128;
/* In case of no-ACK, add ETX_NOACK_PENALTY to the real Tx count, as a penalty */
const ETX_NOACK_PENALTY    = 12;
/* Initial ETX value */
export const ETX_DEFAULT          = 2;

/* Link not updated in FRESHNESS_EXPIRATION_TIMEOUT is not fresh */
const FRESHNESS_EXPIRATION_TIME_SEC  = 10 * 60;
/* Half time for the freshness counter */
const FRESHNESS_HALF_LIFE_SEC        = 15 * 60;
/* Statistics are fresh if the freshness counter is FRESHNESS_TARGET or more */
const FRESHNESS_TARGET               =  4;
/* Maximum value for the freshness counter */
const FRESHNESS_MAX                  = 16;

/* Time for the next periodic processing */
let next_periodic_processing_seconds = FRESHNESS_HALF_LIFE_SEC;

/* Node's TSCH neighbor */
export class Neighbor {
    constructor(node, id) {
        this.node = node;
        this.id = id;
        /* is this neighbor a virtual neighbor used for broadcast (of data packets or EBs) */
        this.is_broadcast = (id === constants.BROADCAST_ID || id === constants.EB_ID);
        /* is this neighbor a time source? */
        this.is_time_source = false;
        /* CSMA backoff exponent */
        this.backoff_exponent = node.config.MAC_MIN_BE; /* use node's config */
        /* CSMA backoff window (number of slots to skip) */
        this.backoff_window = 0;
        /* Last CSMA backoff window */
        this.last_backoff_window = 0;
        /* How many Tx cells do we have to this neighbor? */
        this.tx_cells_count = 0;
        /* The packet queue */
        this.queue = [];

        /* stats */
        this.num_tx = 0;
        this.num_tx_success = 0;
        this.num_rx = 0;
        this.last_tx_sec = null;
        this.last_rx_sec = null;
        this.last_rssi = -Infinity;
        this.freshness = 0;
        /* The ETX is kept as an integer to better emulate the operation on embedded systems */
        this.etx = null;

        /* RPL state */
        this.rpl_rank = 0;
        this.rpl_dtsn = 0;
    }

    get_queue_size() {
        return this.queue.length;
    }

    get_queue_space() {
        return this.node.config.MAC_QUEUE_SIZE - this.queue.length;
    }

    has_packets() {
        return this.queue.length > 0;
    }

    pop_packet() {
        return this.queue.shift();
    }

    push_packet(packet) {
        return this.queue.push(packet);
    }

    on_tx(num_tx, is_success, is_ack_required, cell) {
        this.num_tx += num_tx;
        this.last_tx_sec = time.timeline.seconds;
        this.freshness = Math.min(this.freshness + num_tx, FRESHNESS_MAX);
        if (is_success) {
            this.num_tx_success += 1;
            if (is_ack_required) {
                /* update the Rx time, because we have received the ACK */
                this.last_rx_sec = this.last_tx_sec;
            }
        }
        if (is_ack_required) {
            const old_etx = this.etx;
            this.update_etx(num_tx, is_success, cell);
            log.log(log.DEBUG, this.node, "Node", `on tx, to=${this.id}, success=${is_success} num_tx=${num_tx} etx=${this.etx} old_etx=${old_etx} freshness=${this.freshness}[NEIGHBOR]`);
        }
    }

    on_rx(packet) {
        this.last_rssi = packet.rx_info[this.node.id].rssi;
        this.last_rx_sec = time.timeline.seconds;
        this.num_rx += 1;

        if (this.etx == null) {
            this.init_etx();
        }
    }

    init_etx() {
        if (this.num_rx === 0) {
            this.etx = ETX_DEFAULT * ETX_DIVISOR;
        } else {
            /* A rough estimate of PRR from RSSI, as a linear function where:
             *      RSSI >= -60 results in ETX of 1
             *      RSSI <= -90 results in ETX of 3
             * In the interval, the ETX is from 1 to 3.
             */
            const RSSI_LOW = -90;
            const RSSI_HIGH = -60;
            const RSSI_DIFF = RSSI_HIGH - RSSI_LOW;
            if (this.last_rssi < RSSI_LOW) {
                this.etx = 3.0;
            } else if (this.last_rssi > RSSI_HIGH) {
                this.etx = 1.0;
            } else {
                const c = (RSSI_HIGH - this.last_rssi) / RSSI_DIFF;
                this.etx = 1.0 + c * 2.0;
            }
            this.etx = Math.trunc(this.etx * ETX_DIVISOR);
        }
    }

    update_etx(num_tx, is_success, cell) {
        if (this.etx == null) {
            this.init_etx();
        }

        if (config.EMULATE_6TISCHSIM) {
            /* Only update ETX on dedicated cells */
            if (cell && !cell.is_dedicated()) {
                return;
            }
        }

        const packet_etx = (is_success ? num_tx : ETX_NOACK_PENALTY) * ETX_DIVISOR;
        const alpha = this.link_stats_is_fresh() ? EWMA_ALPHA : EWMA_BOOTSTRAP_ALPHA;
        this.etx = Math.trunc(this.etx * (1.0 - alpha) + packet_etx * alpha);
    }

    link_stats_is_fresh() {
        return time.timeline.seconds - this.last_tx_sec < FRESHNESS_EXPIRATION_TIME_SEC
            && this.freshness >= FRESHNESS_TARGET;
    }

    link_metric() {
        return this.etx;
    }

    floating_point_etx() {
        return this.etx / ETX_DIVISOR;
    }

    reset_neighbor() {
        /* forget the link stats ETX */
        this.init_etx();
    }
}

export function periodic_process(period_seconds, current_seconds)
{
    if (current_seconds >= next_periodic_processing_seconds) {
        log.log(log.INFO, null, "Main", `periodic neighbor processing for all nodes [NEIGHBOR]`);
        for (const [_, node] of simulator.get_nodes()) {
            for (const [_, neighbor] of node.neighbors) {
                neighbor.freshness = Math.trunc(neighbor.freshness / 2);
            }
        }
        
        next_periodic_processing_seconds += FRESHNESS_HALF_LIFE_SEC;
    }
}
