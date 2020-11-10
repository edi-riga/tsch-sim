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
 *         "Leaf and forwarder" routing protocol implementation.
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import config from './config.mjs';

/* Initialize the protocol configuration */
export function initialize(network)
{
    const default_config = {
    };

    for (const key in default_config) {
        /* set the ones that have not been set from the config file */
        if (!config.hasOwnProperty(key)) {
            config[key] = default_config[key];
        }
    }
}

/*---------------------------------------------------------------------------*/

export class LeafAndForwarderRouting
{
    constructor(node) {
        this.node = node;
    }

    start() {
        /* nothing */
    }

    on_tx(neighbor, packet, is_ok, is_ack_required) {
        /* nothing */
    }

    on_prepare_tx_packet(packet) {
        /* nothing */
    }

    on_forward(packet) {
        return true;
    }

    on_new_time_source(old_time_source, new_time_source) {
        if (new_time_source == null) {
            this.node.routes.remove_default_route();
        } else {
            this.node.routes.add_default_route(new_time_source.id);
        }
    }

    local_repair() {
        /* nothing */
    }

    is_joined() {
        return this.node.has_joined;
    }

    on_periodic_timer() {
        /* nothing */
    }

    stats_get() {
        return {
            routing_tx: 0,
            routing_rx: 0,
            routing_join_time_sec: 0,
            routing_num_parent_changes : 1
        };
    }
}
