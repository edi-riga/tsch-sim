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
 *         An application-level packet source
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import config from './config.mjs';
import constants from './constants.mjs';
import * as pkt from './packet.mjs';
import * as log from './log.mjs';
import * as time from './time.mjs';
import { rng } from './random.mjs';

/* ------------------------------------- */

/* generates one packet per period */
export class PacketSource {
    constructor(source, destination, period, is_fixed, is_query, length, warmup_period) {
        this.source = source;
        this.destination_id = destination ? destination.id : -1;
        this.period = period != null ? period : config.APP_PACKET_PERIOD_SEC;
        this.is_fixed = is_fixed != null ? is_fixed : false;
        this.is_query = is_query != null ? is_query : false;
        this.length = length != null ? length : config.APP_PACKET_SIZE;
        this.warmup_period = warmup_period != null ? warmup_period : config.APP_WARMUP_PERIOD_SEC; 
        this.is_in_warmup = true;
        this.timer_time = this.warmup_period;
        this.packets

        log.log(log.INFO, null, "App", `new packet source, from=${source.id} for=${this.destination_id} period=${this.period} warmup=${this.warmup_period} [PACKET_SOURCE]`);

        if (this.destination_id === -1) {
            log.log(log.WARNING, null, "App", `destination ID for a packet source is unspecified; the "app_reliability" statistics will be unreliable and should be ignored`);
        }

        /* add the first timer */
        if (!this.is_fixed) {
            this.timer_time += rng.random() * this.period;
        }
        time.add_timer(this.timer_time, false, this, function(ps) {
            ps.generate();
        });
    }

    generate() {
        let do_generate;

        // Generate packets without caring whether the node has joined routing and tsch
        if (config.APP_PACKETS_GENERATE_ALWAYS) {
            do_generate = true;
        } else {
            /* schedule a packet only if we have connected to the network (RPL & TSCH) */
            do_generate = this.source.routing.is_joined();
        }

        if (do_generate) {
            const packet = new pkt.Packet(this.source, this.destination_id, this.length);
            this.source.seqnum_generator += 1;
            packet.seqnum = this.source.seqnum_generator;
            if (this.is_query) {
                packet.query_status = constants.PACKET_IS_REQUEST;
            }
            log.log(log.INFO, this.source, "App", `generate a packet, seqnum=${packet.seqnum} for=${this.destination_id} [PACKET_SOURCE]`);
            this.source.add_app_packet(packet);
        } else {
            log.log(log.INFO, this.source, "App", `skipping generation of a packet, for=${this.destination_id} [PACKET_SOURCE]`);
        }

        /* add the next timer */
        if (this.is_fixed) {
            /* simply schedule it after the period */
            this.timer_time = this.period;
            time.add_timer(this.timer_time, false, this, function(ps) {
                ps.generate();
            });
        } else {
            /* schedule a function that will randomly reschedule generate() in the future */
            if (this.is_in_warmup) {
                this.is_in_warmup = false;
                this.timer_time = (this.period + this.warmup_period) - this.timer_time;
            } else {
                this.timer_time = this.period - this.timer_time;
            }
            time.add_timer(this.timer_time, false, this, function(ps) {
                ps.next_packet_period();
            });
        }
    }

    /* this function is called at the start of a new packet period */
    next_packet_period() {
        this.timer_time = rng.random() * this.period;
        time.add_timer(this.timer_time, false, this, function(ps) {
            ps.generate();
        });
    }
}

/* generates multiple packets at once; then wait proportionally to the number of packets generated */
export class BurstyPacketSource extends PacketSource {

    generate() {
        const BURST_SIZE = 5;
        for (let i = 0; i < BURST_SIZE; ++i) {
            /* TODO: remove the timer and extend the period */
            super.generate();
        }
    }
}
