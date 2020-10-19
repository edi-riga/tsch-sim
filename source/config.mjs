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
 *         Default configuration values. Can be overwritten in a configuration file.
 *
 *         Note that modules (schedulers etc.) may extend this global configuration
 *         structure by adding their own defaults.
 *         Some examples of files extending this configuration structure are:
 *         - scheduler_orchestra.mjs
 *         - scheduler_6tisch_min.mjs
 *         - routing_rpl.mjs
 *         - link_model.mjs
 *         Other files can add their own overrides / extensions.
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import fs from 'fs';
import process from 'process';

/* -------------------------------------------------------------------- */
/* Load the config file upon loading this module */
/* -------------------------------------------------------------------- */

let config_struct = {};

function load_config(filename)
{
    let config_file_data = null;

    /* read the config file */
    try {
        console.log(`Loading configuration file "${filename}"...`);
        config_file_data = fs.readFileSync(filename);
    } catch(x) {
        /* file not found? just use the default values */
        console.log(`Failed to read the configuration file, using the default config:\n  ${x}`);
        config_struct = {};
    }

    /* parse the file as a JSON */
    try {
        config_struct = JSON.parse(config_file_data);
        console.log(`Configuration file loaded`);
    } catch(x) {
        /* file found, but parsing it failed - quit */
        console.log(`Failed to parse the configuration file, quitting:\n  ${x}`);
        process.exit(-1);
    }
}

/* decide the filename */
const config_file = process.argv.length > 2 ? process.argv[2] : "config.json";
/* load the config immediately, without waiting for main() to be called */
load_config(config_file);

/* -------------------------------------------------------------------- */
/* Default configuration values; can be overriden by the config file */
/* -------------------------------------------------------------------- */

const default_config = {

    /* ------------------------------------- */
    /* Simulation configuration */
    /* ------------------------------------- */

    /* The total duraction of the simulation, seconds */
    SIMULATION_DURATION_SEC: 600,

    /* Random seed */
    SIMULATION_SEED: 0,

    /* Number of runs (each subsequent run gets random seed incremented by one) */
    SIMULATION_NUM_RUNS: 1,

    /* Scripting */
    SIMULATION_SCRIPT_FILE: null,

    /* Emulate the specific behavior of Cooja code to aim for maximum reproducibility. */
    EMULATE_COOJA: false,

    /* Emulate the specific behavior of the 6tisch simulator of the OpenWSN */
    EMULATE_6TISCHSIM: false,

    /* Emulate the specific behavior of the Contiki/Contiki-NG RPL and TSCH implementations */
    EMULATE_CONTIKI: false,

    /* ------------------------------------- */
    /* Scheduling */
    /* ------------------------------------- */

    /* Scheduling algorithm. Available: "Orchestra", "6tischMin", "LeafAndForwarder" */
    SCHEDULING_ALGORITHM: "Orchestra",

    /* Note: the schedule size is given for each scheduling option separately:
     * For 6tisch minimal: TSCH_SCHEDULE_CONF_DEFAULT_LENGTH
     * For Orchestra: ORCHESTRA_EBSF_PERIOD, ORCHESTRA_COMMON_SHARED_PERIOD, ORCHESTRA_UNICAST_PERIOD
     */

    /* ------------------------------------- */
    /* Network stack configuration */
    /* ------------------------------------- */

    /* Default hopping sequence*/
    MAC_HOPPING_SEQUENCE: "TSCH_HOPPING_SEQUENCE_4_4",

    /* Hopping sequence used for joining (the channel scan proces). If null, the default hopseq is used instead */
    MAC_JOIN_HOPPING_SEQUENCE: null,

    /* Start with all nodes in a joined state? */
    MAC_START_JOINED: false,

    /* Max number of re-transmissions */
    MAC_MAX_RETRIES: 7,

    /* The maximum number of outgoing packets towards each neighbor */
    MAC_QUEUE_SIZE: 16,

    /* The maximum number of active subslots in a single TSCH slot (1 in standard TSCH) */
    MAC_MAX_SUBSLOTS: 1,

    /* TSCH slot duration in microseconds */
    MAC_SLOT_DURATION_US: 10000,

    /* Max acceptable join priority */
    MAC_MAX_JOIN_PRIORITY: 32,

    /* How long to scan each channel in the scanning phase */
    MAC_CHANNEL_SCAN_DURATION_SEC: 1,

    /* Min backoff exponent */
    MAC_MIN_BE: 1,
    /* Max backoff exponent */
    MAC_MAX_BE: 5,

    /* Max time before sending a unicast keep-alive message to the time source. Set to 0 to disable. */
    MAC_KEEPALIVE_TIMEOUT_S: 60,
    /* Max time without synchronization before leaving the PAN. Set to 0 to disable. */
    MAC_DESYNC_THRESHOLD_S: 120,
    /* Period between two consecutive EBs */
    MAC_EB_PERIOD_S: 16,
    /* Max period between two consecutive EBs */
    MAC_MAX_EB_PERIOD_S: 16,
    /* EB size in bytes, including MAC header */
    MAC_EB_PACKET_SIZE: 35,

    /* Max MAC packet size, excluding header. 105=127-2-20 is typical: 127 is the limit for IEEE 802.15.4 radios, 2 used by the FCS, 20 bytes by MAC header */
    MAC_MAX_PACKET_SIZE: 105,
    /*
     * The assumed MAC header size. 20 bytes is a sensible dummy value; to get a standard-compliant operation would need
     * to implement the whole IEEE 802.15.4 packet framing logic.
     * Not relevant for EB packets - header overhead is already a part of the MAC_EB_PACKET_SIZE parameter.
     */
    MAC_HEADER_SIZE: 20,
    /* Enable fragmentation? If not enabled, packets larger than max MAC packet size are simply dropped */
    IP_FRAGMENTATION_ENABLED: true,
    /* IP packet reassembly maximal time */
    IP_REASSEMBLY_TIMEOUT_SEC: 8,

    /* Routing algorithm. Available: "RPL", "LeafAndForwarderRouting", "NullRouting" */
    ROUTING_ALGORITHM: "RPL",
    /* Is this node a leaf in the routing tree (does not forward packets)? */
    ROUTING_IS_LEAF: false,

    /*
     * This is required to implement the radio capture effect.
     * The co-channel rejection threshold depends on the chip and technology; some values are:
     * - 802.15.4 radios: -3 dB
     * - BLE radios: -8 dB
     * - FLRC radios: -10 dB
     */
    PHY_CO_CHANNEL_REJECTION_DB: -3,

    /* ------------------------------------- */
    /* Application configuration */
    /* ------------------------------------- */

    /* Size excluding IP and MAC headers */
    APP_PACKET_SIZE: 100,
    /* Data packets are generated once this period */
    APP_PACKET_PERIOD_SEC: 60,
    /* Data packets are not generated before this warm-up period has expired */
    APP_WARMUP_PERIOD_SEC: 100,
    /* If set to true, data packets are generated even if the node is not connected to a network */
    APP_PACKETS_GENERATE_ALWAYS: false,

    /* -------------------------------------------------------------------- */
    /* Positioning */
    /* -------------------------------------------------------------------- */

    /* Number of nodes to generate. Used when nodes are not explicitly defined in NODE_TYPE config */
    POSITIONING_NUM_NODES: 7,
    /* Type of positioning. Available options: "Star", "Line", "Grid", "Mesh". */
    POSITIONING_LAYOUT: "Star",
    /* For line and grid networks, this determines the neighbor distance, for star networks: the radius. */
    /* For mesh networks, this is used as threshold: a link is "good" if its success rate is above this number. */
    POSITIONING_LINK_QUALITY: 0.9,
    /* For mesh networks: the average number of good links from a node. Between 2 and NUM_NODES-1.
       If not set, selected as sqrt(NUM_NODES).
     */
    POSITIONING_NUM_DEGREES: null,
    /* The positioning module may get its own random seed to enable repeatable network generation */
    POSITIONING_RANDOM_SEED: null,

    /* -------------------------------------------------------------------- */
    /* Mobility support */
    /* -------------------------------------------------------------------- */

    /* Available: "Static", "Line", "RandomWaypoint" */
    MOBILITY_MODEL: "Static",

    /* How often to update mobile node positions? (Simulation performance is affected) */
    MOBILITY_UPDATE_PERIOD_SEC: 10,

    /* The nodes move in two dimensions, x \in [0, MOBILITY_RANGE_X], y \in [0, MOBILITY_RANGE_Y] */
    MOBILITY_RANGE_X: 300,
    MOBILITY_RANGE_Y: 300,

    /* In meters per second */
    MOBILITY_SPEED: 0.1,

    /* -------------------------------------------------------------------- */
    /* Web */
    /* -------------------------------------------------------------------- */

    WEB_ENABLED: false,
    WEB_PORT: 2020,
    WEB_MAX_LOGS: 1000,
    WEB_MAX_CELLS: 1000,

    /* -------------------------------------------------------------------- */
    /* Logging */
    /* -------------------------------------------------------------------- */

    LOG_FILE: null,
    /* the format is this: "topic: level" */
    LOG_LEVELS_DEFAULT: {
        "Main": 3,
        "App": 3,
        "Node": 3,
        "TSCH": 3,
        "RPL": 3,
        "Link": 3,
        "Mobility": 3
    },
    LOG_LEVEL_DEFAULT_NOTOPIC: 3,

    SAVE_RESULTS: true,
    /* if null, set automatically to "tsch-sim/results/<currentdatetime>/" */
    RESULTS_DIR: null,

    /* -------------------------------------------------------------------- */
    /* Node type specific config. Can override the default config */
    /* -------------------------------------------------------------------- */

    NODE_TYPES: [],

    /* -------------------------------------------------------------------- */
    /* Config file overrides */
    /* -------------------------------------------------------------------- */

    CONFIG_FILE: config_file,

    ...config_struct
};

/* Export the config settings */
export default default_config;
