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
 *         6TiSCH minimal scheduler.
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import config from './config.mjs';
import constants from './constants.mjs';
import * as log from './log.mjs';
import * as time from './time.mjs';

/* ------------------------------------------------- */

function set_timings()
{
    log.log(log.INFO, 0, "TSCH", `Set timings for the 6Tisch Min [SCHEDULER]`);
    const sf_size = config.TSCH_SCHEDULE_CONF_DEFAULT_LENGTH ? config.TSCH_SCHEDULE_CONF_DEFAULT_LENGTH : 1;

    let timings_usec = new Array(sf_size);
    /* all slots have the same duration */
    for (let i = 0; i < sf_size; ++i) {
        timings_usec[i] = config.MAC_SLOT_DURATION_US;
    }
    time.timeline.slot_timings = timings_usec.map(x => x / 1000000); /* convert to seconds */
}

/*---------------------------------------------------------------------------*/

export function on_new_time_source(node, old_neighbor, new_neighbor)
{
    log.log(log.INFO, node, "TSCH", `On new time source called from 6Tisch Min [SCHEDULER]`);
}

export function on_child_added(node, addr)
{
    log.log(log.INFO, node, "TSCH", `On child added called from 6Tisch Min [SCHEDULER]`);
}

export function on_child_removed(node, addr)
{
    log.log(log.INFO, node, "TSCH", `child removed event handler called from 6Tisch Min [SCHEDULER]`);
}

export function on_packet_ready(node, packet)
{
    return true;
}

export function on_tx(node, packet, status_ok)
{
    log.log(log.INFO, node, "TSCH", `on tx called from 6Tisch Min [SCHEDULER]`);
}

export function add_root(node, root_id)
{
    log.log(log.INFO, node, "TSCH", `Add root called from 6Tisch Min [SCHEDULER]`);
}

export function on_node_becomes_root(node)
{
    log.log(log.INFO, node, "TSCH", `On node becomes root called from 6Tisch Min [SCHEDULER]`);
}

/*---------------------------------------------------------------------------*/

/* Initialize a specific node: function required by the scheduling module API */
export function node_init(node)
{
    log.log(log.INFO, node, "TSCH", `*** initializing 6tisch minimal, slotframe_size=${node.config.TSCH_SCHEDULE_CONF_DEFAULT_LENGTH}`)

    /* Add a single slotframe */
    const sf_common = node.add_slotframe(0, "default", node.config.TSCH_SCHEDULE_CONF_DEFAULT_LENGTH);
    /* Add a single cell shared by all traffic */
    node.add_cell(sf_common,
                  constants.CELL_OPTION_RX | constants.CELL_OPTION_TX | constants.CELL_OPTION_SHARED,
                  constants.CELL_TYPE_ADVERTISING,
                  constants.BROADCAST_ID,
                  0, 0);
}

/* ------------------------------------------------- */

/* Initialize the module: function required by the scheduling module API */
export function initialize()
{
    log.log(log.INFO, null, "TSCH", `initializing 6tisch minimal infrastructure[6 TISCH MIN]`)

    const default_config = {
        /* The length of the 6tisch minimal slotframe */
        TSCH_SCHEDULE_CONF_DEFAULT_LENGTH: 7
    };

    for (const key in default_config) {
        /* set the ones that have not been set from the config file */
        if (!config.hasOwnProperty(key)) {
            config[key] = default_config[key];
        }
    }

    set_timings();
}
