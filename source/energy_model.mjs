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
 *         Energy model.
 *         Given slot usage statistics, calculates charge consumption based on
 *         the regressions in the TSCH energy usage evaluation on a CC2650 node.
 *
 *         WARNING! The model at the moment ignore TSCH slot size settings.
 *         It is accurate only for the default slot timing template (hardcoded below).
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import * as time from './time.mjs';

/* Regresssion obtained by RocketLogger measurements on a CC2650 node (the SPES-2) */
/* These values include both radio and CPU current consumption */
const regression_rx_bc = [0.258910335917, 21.816774572];
const regression_rx_uc = [0.244439144648, 38.3440721024];
const regression_tx_bc = [0.399234139478, 13.67152911];
const regression_tx_uc = [0.345405572975, 36.5460914801];

/*
 * System consumption values measured on SPES-2
 * These CPU values are not used in the model at the moment,
 * as the model only takes into account TSCH related current consumption.
 */
const CURRENTS_MA = {
    cpu: 2.703,
    lpm: 1.335,
    deep_lpm: 0.016,
    rx: 7.0
};

/* XXX: hardcoded slot timing */
const TSCH_SLOT_SIZE_USEC   = 10000;
const TSCH_SLOT_RX_WAIT_USEC = 2200;
const TSCH_SLOT_ACK_WAIT_USEC = 400;
const TSCH_BYTE_USEC           = 32;


const PREAMBLE_SIZE = 4;
const SFD_SIZE = 1;
const LENGTH_SIZE = 1;
const FCS_SIZE = 2;
const PHY_OVERHEAD_BYTES = PREAMBLE_SIZE + SFD_SIZE + LENGTH_SIZE + FCS_SIZE;

/* XXX: hardcoded; would be more if security is enabled due to the security header */
const MAC_ACK_SIZE = 17;
const PHY_ACK_SIZE = MAC_ACK_SIZE + PHY_OVERHEAD_BYTES;

/* current consumption microcoulumbs in a scanning slot (radio always on), slot size 10 milliseconds */
const SCANNING_SLOT_UC = CURRENTS_MA.rx * TSCH_SLOT_SIZE_USEC / 1000.0;

function get_packet_charges_uc_per_size(regression, stats) {
    let result = 0;
    for (let i = 0; i < stats.length; ++i) {
        /* no need to account for the extra PHY size as the regressions are based on empirical measurements */
        result += stats[i] * (i * regression[0] + regression[1]);
    }
    return result;
}

/* charges given in microcoulumbs */
function get_packet_charges_uc() {
    return {
        stats_slots_rx_scanning: function(stats) { return stats * SCANNING_SLOT_UC },
        stats_slots_rx_idle: function(stats) { return stats * regression_rx_bc[1] },
        stats_slots_rx_packet: function(stats) { return get_packet_charges_uc_per_size(regression_rx_bc, stats) },
        stats_slots_rx_packet_tx_ack: function(stats) { return get_packet_charges_uc_per_size(regression_rx_uc, stats) },
        stats_slots_tx_packet: function(stats) { return get_packet_charges_uc_per_size(regression_tx_bc, stats) },
        stats_slots_tx_packet_rx_ack: function(stats) { return get_packet_charges_uc_per_size(regression_tx_uc, stats) },
    };
}

function from_mc_to_mah(x)
{
    return x / 3600.0;
}

function from_uc_to_mc(x)
{
    return x / 1000;
}

export function estimate_charge_uc(slot_stats)
{
    const packet_charges_uc = get_packet_charges_uc();

    const result = {};
    let total = 0;
    for (const key in packet_charges_uc) {
        const charge = packet_charges_uc[key](slot_stats[key]);
        result[key] = charge;
        total += charge;
    }
    result.total = total;
    result.scanning = SCANNING_SLOT_UC * slot_stats.stats_slots_rx_scanning;
    return result;
}

export function estimate_charge_mc(slot_stats)
{
    const packet_charges_uc = get_packet_charges_uc();
    const result = estimate_charge_uc(slot_stats);
    for (const key in packet_charges_uc) {
        result[key] = from_uc_to_mc(result[key]);
    }
    result.total = from_uc_to_mc(result.total);
    result.scanning = from_uc_to_mc(result.scanning);
    return result;
}

export function estimate_charge_mah(slot_stats)
{
    const packet_charges_uc = get_packet_charges_uc();
    const result = estimate_charge_mc(slot_stats);
    for (const key in packet_charges_uc) {
        result[key] = from_mc_to_mah(result[key]);
    }
    result.total = from_mc_to_mah(result.total);
    result.scanning = from_mc_to_mah(result.scanning);
    return result;
}

export function estimate_duty_cycle(stats)
{
    const total_usec = time.timeline.seconds * 1000000;
    if (!total_usec) {
        return {
            scanning: 0,
            tx: 0,
            rx: 0,
            total: 0,
        };
    }

    let rx_usec = 0;
    let tx_usec = 0;

    const scanning_usec = stats.stats_slots_rx_scanning * TSCH_SLOT_SIZE_USEC;
    rx_usec += scanning_usec;
    rx_usec += stats.stats_slots_rx_idle * TSCH_SLOT_RX_WAIT_USEC;

    /* received broadcasts */
    for (let i in stats.stats_slots_rx_packet) {
        let bytes = +i + PHY_OVERHEAD_BYTES;
        rx_usec += stats.stats_slots_rx_packet[i] * TSCH_BYTE_USEC * bytes;
    }
    /* received unicasts */
    for (let i in stats.stats_slots_rx_packet_tx_ack) {
        let bytes = +i + PHY_OVERHEAD_BYTES;
        rx_usec += stats.stats_slots_rx_packet_tx_ack[i] * TSCH_BYTE_USEC * bytes + TSCH_SLOT_RX_WAIT_USEC / 2;
        tx_usec += stats.stats_slots_rx_packet_tx_ack[i] * TSCH_BYTE_USEC * PHY_ACK_SIZE;
    }
    /* transmitted broadcasts */
    for (let i in stats.stats_slots_tx_packet) {
        let bytes = +i + PHY_OVERHEAD_BYTES;
        tx_usec += stats.stats_slots_tx_packet[i] * TSCH_BYTE_USEC * bytes;
    }
    /* transmitted unicasts */
    for (let i in stats.stats_slots_tx_packet_rx_ack) {
        let bytes = +i + PHY_OVERHEAD_BYTES;
        rx_usec += stats.stats_slots_tx_packet_rx_ack[i] * TSCH_BYTE_USEC * PHY_ACK_SIZE + TSCH_SLOT_ACK_WAIT_USEC / 2;
        tx_usec += stats.stats_slots_tx_packet_rx_ack[i] * TSCH_BYTE_USEC * bytes;
    }

    return {
        scanning: scanning_usec / total_usec,
        tx: tx_usec / total_usec,
        rx: rx_usec / total_usec,
        total: (tx_usec + rx_usec) / total_usec,
    };
}
