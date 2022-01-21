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
 *         Radio link propagation models
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import config from "./config.mjs";
import constants from './constants.mjs';
import { rng } from './random.mjs';
import { get_node_distance } from './utils.mjs';
import * as log from './log.mjs';
import * as time from './time.mjs';
import * as simulator from './simulator.mjs';

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

/* ------------------------------------- */

/* Module logging */
function mlog(severity, msg) {
    log.log(severity, null, "Link", msg);
}

/* ------------------------------------- */

/* Generic network link */
export class Link {
    constructor(from, to, link_quality, rssi) {
        this.from = from;
        this.to = to;
        this.link_quality = (link_quality == null) ? 1.0 : link_quality;
        this.is_active = true;
        if (this.link_quality > 1.0) {
            mlog(log.WARNING, `link quality must be between 0.0 and 1.0 not quality=${this.link_quality}; setting it to 1.0`);
            this.link_quality = 1.0;
        } else if (this.link_quality < 0) {
            mlog(log.WARNING, `link quality must be between 0.0 and 1.0, not quality=${this.link_quality}; setting it to 0.0`);
            this.link_quality = 0;
        }
        this.avg_rssi = rssi ? rssi : -70;
        this.last_rssi = null;
    }

    /* Additive white Gaussian noise */
    getAWGN() {
        return rng.next_gaussian() * this.from.config.AWGN_GAUSSIAN_STD;
    }

    /*
     * Simulate a sending attempt; returns true if the sending was successful.
     * Note that collisions will still cause packets to be dropped even if this returns true.
     */
    try_send(channel) {
        /* keep it simple for now: add some Gaussian noise*/
        this.last_rssi = this.avg_rssi + this.getAWGN();
        const q = typeof(this.link_quality) === "object" ?
              this.link_quality[channel] :
              this.link_quality;
        const is_success = rng.random() < q;
        mlog(log.DEBUG, `tx from=${this.from.id} to=${this.to.id} quality=${q} ok=${is_success}`);
        return is_success;
    }

    get_average_success_rate() {
        const q = typeof(this.link_quality) === "object" ?
              this.link_quality.values().avg() :
              this.link_quality;
        return q;
    }
}

/* ------------------------------------- */

/* Network link using the logistic function to model PDR from RSSI */
export class LogisticLossLink extends Link {
    constructor(from, to) {
        super(from, to, 1.0); /* note that the `link_quality` parameter is ignored */
        this.update();
    }

    update() {
        this.is_active = (get_node_distance(this.from, this.to) <= this.from.config.LOGLOSS_TRANSMIT_RANGE_M);
    }

    getRSSI() {
        let d = get_node_distance(this.from, this.to);
        if (d <= 0) {
            /* do not allow the distance to be zero */
            d = 0.01;
        } else if (d >= this.from.config.LOGLOSS_TRANSMIT_RANGE_M) {
            /* no chance of reception */
            return this.from.config.LOGLOSS_RX_SENSITIVITY_DBM;
        }

        /* Using the log-distance formula */
        const path_loss_dbm = -this.from.config.LOGLOSS_RX_SENSITIVITY_DBM
              + 10 * config.LOGLOSS_PATH_LOSS_EXPONENT * Math.log10(d / this.from.config.LOGLOSS_TRANSMIT_RANGE_M);

        mlog(log.DEBUG, `dist=${d} loss=${path_loss_dbm}`);
        return this.from.config.TX_POWER_DBM - path_loss_dbm;
    }

    /*
     * Simulate a sending attempt; returns true if the sending was successful.
     * Note that collisions will still cause packets to be dropped even if this returns true.
     */
    try_send(channel) {
        /* use the logistic function to model packet loss depending on RSSI */
        this.last_rssi = this.getRSSI();
        if (this.last_rssi <= this.from.config.LOGLOSS_RX_SENSITIVITY_DBM) {
            /* if not above the sensitivity limit, always count as failed */
            return false;
        }
        this.last_rssi += this.getAWGN(); /* add some noise */
        const x = this.last_rssi - this.from.config.LOGLOSS_RSSI_INFLECTION_POINT_DBM;
        const success_rate = 1.0 / (1.0 + Math.exp(-x));
        const is_success = rng.random() < success_rate;
        mlog(log.DEBUG, `tx from=${this.from.id} to=${this.to.id} quality=${success_rate} ok=${is_success}`);
        return is_success;
    }

    get_average_success_rate() {
        const rssi = this.getRSSI();
        if (rssi <= this.from.config.LOGLOSS_RX_SENSITIVITY_DBM) {
            /* if not above the sensitivity limit, assume no chance of success */
            return 0.0;
        }
        const x = rssi - this.from.config.LOGLOSS_RSSI_INFLECTION_POINT_DBM;
        return 1.0 / (1.0 + Math.exp(-x));
    }
}

/* ------------------------------------- */
/* ------------------------------------- */

const SS_STRONG = -10; /* dBm */
const SS_WEAK = -95; /* dBm */

/* Network link using the Unit Disk Graph model */
export class UnitDiskGraphLink extends Link {
    constructor(from, to) {
        super(from, to);
        this.update();
    }

    update() {
        this.is_active = (get_node_distance(this.from, this.to) <= this.from.config.UDGM_TRANSMIT_RANGE_M);
    }

    getRSSI() {
        const d = get_node_distance(this.from, this.to);
        const dist_ratio = d / this.from.config.UDGM_TRANSMIT_RANGE_M;
        const rssi = this.from.config.TX_POWER_DBM + SS_STRONG + dist_ratio * (SS_WEAK - SS_STRONG);
        mlog(log.DEBUG, `dist=${d} rssi=${rssi}`);
        return rssi;
    }

    /*
     * Simulate a sending attempt; returns true if the sending was successful.
     * Note that collisions will still cause packets to be dropped even if this returns true.
     */
    try_send(channel) {
        const d = get_node_distance(this.from, this.to);
        const dist_ratio = d / this.from.config.UDGM_TRANSMIT_RANGE_M;
        this.last_rssi = this.from.config.TX_POWER_DBM + SS_STRONG + dist_ratio * (SS_WEAK - SS_STRONG);
        let is_success;
        let success_rate;
        if (dist_ratio <= 1) {
            if (this.from.config.UDGM_CONSTANT_LOSS) {
                success_rate = this.from.config.UDGM_RX_SUCCESS;
            } else {
                const dist_squared = d * d;
                const dist_max_squared = this.from.config.UDGM_TRANSMIT_RANGE_M * this.from.config.UDGM_TRANSMIT_RANGE_M;
                const dist_squared_ratio = dist_squared / dist_max_squared;
                success_rate = 1.0 - dist_squared_ratio * (1.0 - this.from.config.UDGM_RX_SUCCESS);
            }
            is_success = rng.random() < success_rate;
        } else {
            /* too far */
            success_rate = 0.0;
            is_success = false;
        }
        mlog(log.DEBUG, `tx from=${this.from.id} to=${this.to.id} quality=${success_rate} ok=${is_success}`);
        return is_success;
    }

    get_average_success_rate() {
        const d = get_node_distance(this.from, this.to);
        const dist_ratio = d / this.from.config.UDGM_TRANSMIT_RANGE_M;
        if (dist_ratio > 1) {
            return 0.0;
        }
        if (this.from.config.UDGM_CONSTANT_LOSS) {
            return this.from.config.UDGM_RX_SUCCESS;
        }

        const dist_squared = d * d;
        const dist_max_squared = this.from.config.UDGM_TRANSMIT_RANGE_M * this.from.config.UDGM_TRANSMIT_RANGE_M;
        const dist_squared_ratio = dist_squared / dist_max_squared;
        return 1.0 - dist_squared_ratio * (1.0 - this.from.config.UDGM_RX_SUCCESS);
    }
}

/* ------------------------------------- */

/* The Pister Hack model, taken from the OpenWSN 6tisch simulator */

/* RSSI and PDR relationship obtained by experiment; dataset was available
 * at the link shown below:
 * http://wsn.eecs.berkeley.edu/connectivity/?dataset=dust */
const RSSI_PDR_TABLE = {
    '-97':    0.0000,  /* this value is not from experiment */
    '-96':    0.1494,
    '-95':    0.2340,
    '-94':    0.4071,
    /* <-- 50% PDR is here, at RSSI=-93.6 */
    '-93':    0.6359,
    '-92':    0.6866,
    '-91':    0.7476,
    '-90':    0.8603,
    '-89':    0.8702,
    '-88':    0.9324,
    '-87':    0.9427,
    '-86':    0.9562,
    '-85':    0.9611,
    '-84':    0.9739,
    '-83':    0.9745,
    '-82':    0.9844,
    '-81':    0.9854,
    '-80':    0.9903,
    '-79':    1.0000,  /* this value is not from experiment */
}

export class PisterHackLink extends Link {
    constructor(from, to) {
        super(from, to);
        this.update();
    }

    update() {
        const rssi = this.getRSSI();
        this.is_active = (rssi > -97 + this.from.config.PHY_CO_CHANNEL_REJECTION_DB);
    }

    get_variation() {
        return rng.uniform(-this.from.config.PISTER_HACK_LOWER_SHIFT / 2, +this.from.config.PISTER_HACK_LOWER_SHIFT / 2);
    }

    getRSSI() {
        let d = get_node_distance(this.from, this.to);
        if (d <= 0) {
            /* do not allow the distance to be zero */
            d = 0.01;
        }

        const free_space_path_loss = constants.SPEED_OF_LIGHT / (4 * Math.PI * d * constants.TWO_DOT_FOUR_GHZ);
        /* mlog(log.DEBUG, `dist=${d} loss=${free_space_path_loss}`);*/

        /* use simple Friis equation as in Pr = Pt + Gt + Gr + 20log10(fspl) */
        const antenna_gain_tx = 0.0;
        const antenna_gain_rx = 0.0;
        return this.from.config.TX_POWER_DBM + antenna_gain_tx + antenna_gain_rx
            + 20 * Math.log10(free_space_path_loss) - this.from.config.PISTER_HACK_LOWER_SHIFT / 2;
    }

    /*
     * Simulate a sending attempt; returns true if the sending was successful.
     * Note that collisions will still cause packets to be dropped even if this returns true.
     */
    try_send(channel) {
        this.last_rssi = this.getRSSI() + this.get_variation();

        const MIN_RSSI = -97;
        const MAX_RSSI = -79;

        let is_success;
        if (this.last_rssi <= MIN_RSSI) {
            is_success = false;
        } else if (this.last_rssi >= MAX_RSSI) {
            is_success = true;
        } else {
            const floor_rssi = Math.floor(this.last_rssi);
            const pdr_low    = RSSI_PDR_TABLE[floor_rssi];
            const pdr_high   = RSSI_PDR_TABLE[floor_rssi + 1];
            /* linear interpolation */
            const success_rate = (pdr_high - pdr_low) * (this.last_rssi - floor_rssi) + pdr_low;
            is_success = rng.random() < success_rate;
        }

        mlog(log.DEBUG, `tx from=${this.from.id} to=${this.to.id} rssi=${this.last_rssi} ok=${is_success}`);
        return is_success;
    }

    get_average_success_rate() {
        const rssi = this.getRSSI();

        const MIN_RSSI = -97;
        const MAX_RSSI = -79;

        if (this.last_rssi <= MIN_RSSI) {
            return 0.0;
        }
        if (this.last_rssi >= MAX_RSSI) {
            return 1.0;
        }
        const floor_rssi = Math.floor(rssi);
        const pdr_low    = RSSI_PDR_TABLE[floor_rssi];
        const pdr_high   = RSSI_PDR_TABLE[floor_rssi + 1];
        /* linear interpolation */
        return (pdr_high - pdr_low) * (this.last_rssi - floor_rssi) + pdr_low;
    }
}

/* ------------------------------------- */

export class TraceLink extends Link {
    constructor(from, to) {
        super(from, to);
    }
}

class TraceManager {
    constructor() {
        this.timer = null;
        this.clear();
    }

    parse_trace(contents) {
        this.clear();

        const lines = contents.split("\n");
        let start_ts = null;
        /* start from line number 2 */
        for (let i = 2; i < lines.length; ++i) {
            const line = lines[i].trim();
            if (line.length <= 0) {
                continue;
            }
            const fields = line.split(",");
            if (fields.length < 7) {
                mlog(log.WARNING, `ignoring a short line in tracefile: ${lines[i]}`);
                continue;
            }
            try {
                const ts = Date.parse(fields[0]);
                let relative_time;
                if (start_ts == null) {
                    start_ts = ts;
                    relative_time = 0;
                } else {
                    relative_time = (ts - start_ts) / 1000.0;
                }
                /* simulator nodes have ID starting from 1, tracefiles: from 0 */
                const from_id = parseInt(fields[1]) + 1;
                const to_id = parseInt(fields[2]) + 1;
                const channel = parseInt(fields[3]);
                const rssi = parseFloat(fields[4]);
                const quality = parseFloat(fields[5]);
                this.events.push({ts: relative_time, from_id, to_id, channel, rssi, quality});
            } catch(x) {
                mlog(log.ERROR, `got an exception while parsing trace file: "${x}" in line="${line}"`);
                continue;
            }
        }

        if (this.events.length) {
            this.current_event = 0;
            time.add_timer(0, false, this, function(tm) {
                tm.handle_timer();
            });
        }
    }

    handle_timer() {
        const start_ts = this.events[this.current_event].ts;
        while (this.events[this.current_event].ts <= start_ts) {
            this.modify_link(this.events[this.current_event]);
            this.current_event += 1;
            if (this.current_event >= this.events.length) {
                return;
            }
        }

        const ts_delta = this.events[this.current_event].ts - start_ts;
        /* XXX: error accumulation possible! */
        time.add_timer(ts_delta, false, this, function(tm) {
            tm.handle_timer();
        });
    }

    modify_link(event) {
        let link = simulator.state.network.find_link(event.from_id, event.to_id);
        if (link) {
            mlog(log.INFO, `modifying link ${event.from_id}->${event.to_id} channel=${event.channel} quality=${event.quality}`);

            if (event.channel === -1) {
                /* all channels */
                link.link_quality = event.quality;
            } else {
                /* specific channel */
                if (typeof(link.link_quality) !== "object") {
                    mlog(log.WARNING, `changing single channel link ${event.from_id}->${event.to_id} to multichannel one`);
                    link.link_quality = {};
                }
                link.link_quality[event.channel] = event.quality;
            }
        } else {
            const from_node = simulator.state.network.find_node(event.from_id);
            const to_node = simulator.state.network.find_node(event.to_id);
            if (!from_node) {
                mlog(log.WARNING, `ignoring trace entry from node ${event.from_id}: no such node`);
            } else if (!to_node) {
                mlog(log.WARNING, `ignoring trace entry to node ${event.to_id}: no such node`);
            } else {
                const connection = {"RSSI": event.rssi, "LINK_MODEL": "Fixed" };
                if (event.channel === -1) {
                    /* all channels */
                    connection.LINK_QUALITY = event.quality;
                } else {
                    /* specific channel */
                    connection.LINK_QUALITY = {};
                    connection.LINK_QUALITY[event.channel] = event.quality;
                }
                mlog(log.INFO, `creating link ${event.from_id}->${event.to_id} channel=${event.channel} quality=${event.quality}`);
                link = create_link(from_node, to_node, connection);
                simulator.state.network.add_link(link);
            }
        }
    }

    load_trace_file(filename) {
        this.clear();

        /* trace file specified; write it even if SAVE_RESULT is false */
        if (!path.isAbsolute(filename)) {
            /* expand the path of the trace file relative to the config file */
            filename = path.join(path.dirname(config.CONFIG_FILE), filename);
        }

        let trace_file_data;
        try {
            trace_file_data = fs.readFileSync(filename);
        } catch(x) {
            mlog(log.ERROR, `error reading trace file ${filename}: ${x}`);
            return;
        }

        /* the trace file is a gzipped archive? */
        if (path.extname(config.TRACE_FILE) == ".gz") {
            /* decompress the file */
            trace_file_data = zlib.gunzipSync(trace_file_data);
        }

        this.parse_trace(trace_file_data.toString());
    }

    load_compressed_file(filename) {
        let trace_file_data;
        try {
            trace_file_data = fs.readFileSync(filename);
        } catch(x) {
            mlog(log.ERROR, `error reading trace file ${filename}: ${x}`);
            return;
        }

        const decompressed_data = zlib.gunzipSync(trace_file_data);
        this.parse_trace(decompressed_data.toString());
    }

    clear() {
        this.events = [];
        this.current_event = -1;
        if (this.timer) {
            time.remove_timer(this.timer);
            this.timer = null;
        }
    }
}

let trace_manager = new TraceManager();

/* ------------------------------------- */

export function create_link(from, to, connection)
{
    const link_model = "LINK_MODEL" in connection ? connection.LINK_MODEL : "Fixed";
    if (link_model === "Fixed" || "LINK_QUALITY" in connection) {
        const link_quality = "LINK_QUALITY" in connection ? connection.LINK_QUALITY : 1.0;
        const rssi = "RSSI" in connection ? connection.RSSI : -70;
        mlog(log.DEBUG, `add link, from=${from.id} to=${to.id} rssi=${rssi} quality=${link_quality}`);
        return new Link(from, to, link_quality, rssi);
    }
    if (link_model === "UDGM") {
        mlog(log.DEBUG, `add UDGM link, from=${from.id} to=${to.id}`);
        return new UnitDiskGraphLink(from, to);
    }
    if (link_model === "LogisticLoss") {
        mlog(log.DEBUG, `add LogisticLoss link, from=${from.id} to=${to.id}`);
        return new LogisticLossLink(from, to);
    }
    if (link_model === "PisterHack") {
        return new PisterHackLink(from, to);
    }

    /* link model not explicitly defined; fallback to the default options */
    mlog(log.WARNING, `unknown link model "${link_model}", using ${from.config.EMULATE_6TISCHSIM ? "PisterHack" : "LogisticLoss"}`);
    if (from.config.EMULATE_6TISCHSIM) {
        mlog(log.DEBUG, `add PisterHack link, from=${from.id} to=${to.id}`);
        return new PisterHackLink(from, to);
    }

    mlog(log.DEBUG, `add LogisticLoss link, from=${from.id} to=${to.id}`);
    return new LogisticLossLink(from, to);
}

/* ------------------------------------- */

export function initialize()
{
    const default_config = {
        TX_POWER_DBM: 0, /* output power in dBm, for UDGM, LogLoss and PisterHack models */

        LOGLOSS_TRANSMIT_RANGE_M: 200.0, /* in meters */

        /* The maximal signal strength in dBm when the PRR is approximately 0% */
        LOGLOSS_RX_SENSITIVITY_DBM: -100,
        /*
         * This is the inflection point of the logistic loss function, i.e. where the second-order derivative becomes negative.
         * It is also the point where 50% of packets with this signal strength are received.
         */
        LOGLOSS_RSSI_INFLECTION_POINT_DBM: -96,

        /* For the log-distance model, indoors, 2.4 GHz */
        LOGLOSS_PATH_LOSS_EXPONENT: 3.0,

        /* For the Unit Disk Graph Model */
        UDGM_TRANSMIT_RANGE_M: 50.0, /* in meters */
        UDGM_RX_SUCCESS: 1.0,
        UDGM_CONSTANT_LOSS: false, /* dependent on distance? */

        /* The standard deviation of the AWGN distribution */
        AWGN_GAUSSIAN_STD: 0.0,

        /* How much to shift the RSSI lower bound downward from the theoretical prediction */
        PISTER_HACK_LOWER_SHIFT: 40 /* db */
    }

    for (const key in default_config) {
        /* set the ones that have not been set from the config file */
        if (!config.hasOwnProperty(key)) {
            config[key] = default_config[key];
        }
    }

    if (config.TRACE_FILE) {
        trace_manager.load_trace_file(config.TRACE_FILE);
    }
}
