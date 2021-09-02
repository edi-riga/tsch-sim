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
 *         The TSCH simulator: main file for setting up the network,
 *         nodes, link and mobility models etc.
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import constants from './constants.mjs';
import config from './config.mjs';
import * as utils from './utils.mjs';
import * as mobility from './mobility.mjs';
import * as link_model from './link_model.mjs';
import * as scheduler_orchestra from './scheduler_orchestra.mjs';
import * as scheduler_6tisch_min from './scheduler_6tisch_min.mjs';
import * as scheduler_lf from './scheduler_lf.mjs';
// Import new scheduler
import * as scheduler_new from './scheduler_new.mjs';
import * as log from './log.mjs';
import * as time from './time.mjs';
import * as route from './route.mjs';
import * as rpl from './routing_rpl.mjs';
import * as nullrouting from './routing_null.mjs';
import * as lfrouting from './routing_lf.mjs';
// Import the new routing algorithm
import * as routing_manual from './routing_manual.mjs';
import * as neighbor from './neighbor.mjs';
import * as network from './network.mjs';
import * as networknode from './node.mjs';
import * as pkt from './packet.mjs';
import * as ps from './packet_source.mjs';
import * as random from './random.mjs';
import status from './status.mjs';
import dirnames from './dirnames.mjs';
import generate_network from './generate_network.mjs';
import fs from 'fs';
import path from 'path';
import process from 'process';

/* Select which scheduler to use */
let scheduler = scheduler_6tisch_min;
if (config.SCHEDULING_ALGORITHM === "Orchestra") {
    scheduler = scheduler_orchestra;
} else if (config.SCHEDULING_ALGORITHM === "LeafAndForwarder") {
    scheduler = scheduler_lf;
} else if (config.SCHEDULING_ALGORITHM === "NewScheduler") {
    scheduler = scheduler_new;
} else if (config.SCHEDULING_ALGORITHM !== "6tischMin") {
    /* use default, but complain! */
    log.log(log.ERROR, null, "Main", `failed to find scheduler "${config.SCHEDULING_ALGORITHM}", using 6tisch minimal[SIMULATOR]`);
}

/* ------------------------------------- */

const PERIODIC_TIMER_SEC = 60;

function periodic_bookeeping(user_param, seconds)
{
    /* print time and simulation progress periodically */
    const progress = 100 * seconds / config.SIMULATION_DURATION_SEC;
    log.log(log.INFO, null, "Main", `${Math.trunc(seconds)} seconds, progress ${progress.toFixed(2)}%[SIMULATOR]`);
    /* process routes */
    route.periodic_process(PERIODIC_TIMER_SEC, seconds);
    /* process neighbors */
    neighbor.periodic_process(PERIODIC_TIMER_SEC, seconds);
    /* process stats */
    networknode.periodic_process(PERIODIC_TIMER_SEC, seconds);
}

/* ------------------------------------- */

/*
 * If the config is found to be invalid/inconsistent,
 * this function attempts to changes the config to fix that.
 */
function check_config_validity()
{
    if (config.APP_PACKETS_GENERATE_ALWAYS && config.EMULATE_6TISCHSIM) {
        log.log(log.WARNING, null, "Main", `options config.APP_PACKETS_GENERATE_ALWAYS and config.EMULATE_6TISCHSIM are incompatible, ignoring the former[SIMULATOR]`);
        config.APP_PACKETS_GENERATE_ALWAYS = false;
    }

    if (utils.has_nonempty_array(config, "CONNECTIONS") && config.TRACE_FILE) {
        log.log(log.WARNING, null, "Main", `options config.CONNECTIONS and config.TRACE_FILE are incompatible, ignoring the former[SIMULATOR]`);
        config.CONNECTIONS = [];
    }
}

function check_node_validity(node)
{
    if (node.links.size === 0 && !config.TRACE_FILE) {
        log.log(log.WARNING, null, "Main", `node ${node.id} of type "${node.config.NAME}" has no valid connections[SIMULATOR]`);
    }
}

function check_node_type_validity(node_type)
{
    if (!node_type.NAME) {
        return false;
    }
    if (!node_type.COUNT) {
        return false;
    }
    return true;
}

function is_valid_node_id(network, node_id)
{
    return network.nodes.has(node_id);
}


/* ------------------------------------- */

function parse_position(network, position)
{
    const node_id = position.ID;
    // Check if the node id is valid
    if (is_valid_node_id(network, node_id)) {
        const node = network.get_node(node_id);
        // Check position subarray for X coordinate
        if (position.hasOwnProperty("X")) {
            // Set node position values
            node.pos_x = parseInt(position.X);
            if (isNaN(node.pos_x)) {
                log.log(log.WARNING, node, "Main", `invalid position X coordinate=${position.X} specified[SIMULATOR]`);
                node.pos_x = 0;
            }
        }
        // Check position subarray for Y coordinate
        if (position.hasOwnProperty("Y")) {
            // Set node position values
            node.pos_y = parseInt(position.Y);
            if (isNaN(node.pos_y)) {
                log.log(log.WARNING, node, "Main", `invalid position Y coordinate=${position.Y} specified[SIMULATOR]`);
                node.pos_y = 0;
            }
        }
    } else {
        log.log(log.WARNING, null, "Main", `position specified for unknown node ID=${node_id}[SIMULATOR]`);
    }
}

/* ------------------------------------- */

export function construct_simulation(is_from_web)
{
    /* init time first */
    time.reset_time();
    time.add_timer(PERIODIC_TIMER_SEC, true, null, periodic_bookeeping);

    log.log(log.INFO, null, "Main", `initializing ${config.SIMULATION_DURATION_SEC} seconds long simulation...[SIMULATOR]`);

    check_config_validity();

    /* reset the web interface status array */
    status.network.nodes = [];
    status.network.transmissions = [];
    status.schedule = [];
    status.log = [];

    /* now start component initialization */
    log.log(log.DEBUG, null, "Main", `initializing the RNG with seed ${config.SIMULATION_SEED}[SIMULATOR]`);
    random.rng.seed(config.SIMULATION_SEED);

    /* init link model configuration */
    link_model.initialize();

    /* create the network */
    const net = new network.Network();

    let routing;
    if (config.ROUTING_ALGORITHM === "RPL") {
        routing = rpl;
    } else if (config.ROUTING_ALGORITHM === "LeafAndForwarderRouting") {
        routing = lfrouting;
    } else if (config.ROUTING_ALGORITHM === "NullRouting") {
        routing = nullrouting;
    } else if (config.ROUTING_ALGORITHM === "ManualRouting") {
        routing = routing_manual;
    }

    /* init routing protocol */
    routing.initialize(net);

    /* set mobility */
    if (config.MOBILITY_MODEL && config.MOBILITY_MODEL !== "Static") {
        net.mobility_model = new mobility.MobilityModel(net);
    }

    /* init the scheduler (e.g. Orchestra) slotframe infrasturcture */
    scheduler.initialize();

    /* set state variables */
    state.network = net;
    state.scheduler = scheduler;
    state.routing = routing;
    state.config = config;
    state.timeline = time.timeline;
    state.log = log;
    state.ps = ps;
    state.pkt = pkt;
    state.constants = constants;

    // previous id is the id of the last node created for a certain node type
    let previous_id = 0;
    // List of nodes of a particular type
    const type_ids = {};
    // Boolean indicators to shows if the values are specified in config.json
    let nodes_set_manually = false;
    let positions_set_manually = false;
    let connections_set_manually = false;

    const types_with_connections_out = {};
    const types_with_connections_in = {};

    // Loop through all Node types in the configuration
    // NODE_TYPES is an array in config.json which contains keys for sub arrays
    for (const node_type of config.NODE_TYPES) {
        if (!check_node_type_validity(node_type)) {
            log.log(log.WARNING, null, "Main", `invalid node type "${node_type.NAME}"[SIMULATOR]`);
            continue;
        }

        log.log(log.INFO, null, "Main", `creating ${node_type.COUNT} "${node_type.NAME}" nodes...[SIMULATOR]`);

        /* set the default config and override it with type-specific values */
        const type_config = JSON.parse(JSON.stringify(config));
        // Display all Keys in the NODE TYPE
        //log.log(log.INFO, this, "Node", `Keys for Node Type ${node_type.NAME}`);
        for (let key in node_type) {
            //log.log(log.INFO, this, "Node", `Key: ${key}`)
            type_config[key] = node_type[key];
        }

        // Set the node type starting from START_ID
        type_ids[node_type.NAME] = [];
        let id = "START_ID" in node_type ? node_type["START_ID"] : previous_id + 1;
        for (let i = 0; i < node_type.COUNT; ++i) {
            previous_id = id;
            // Add node to the network after determining its type
            net.add_node(id, type_config);
            type_ids[node_type.NAME].push(id);
            id += 1;
        }

        if (!net.mobility_model && type_config.MOBILITY_MODEL && type_config.MOBILITY_MODEL !== "Static") {
            net.mobility_model = new mobility.MobilityModel(net);
        }

        nodes_set_manually = true;
    }

    // Add automatically created nodes in case the nodes havent been specified in the config.json file
    if (!nodes_set_manually) {
        /* Add some automatically created nodes */
        const type_name = "node";
        const type_config = JSON.parse(JSON.stringify(config));
        type_config["NAME"] = type_name;
        type_ids[type_name] = [];
        for (let id = 1; id <= config.POSITIONING_NUM_NODES; ++id) {
            net.add_node(id, type_config);
            type_ids[type_name].push(id);
        }
    }

    /* Set up positions */
    // Loop through each node type
    for (const from_node_type of config.NODE_TYPES) {
        if (!check_node_type_validity(from_node_type)) {
            continue;
        }

        // If the NODE_TYPES array inside config.json specifies positions of the nodes
        if (utils.has_nonempty_array(from_node_type, "POSITIONS")) {
            /* Positions for the node type */
            positions_set_manually = true;
            for (const position of from_node_type.POSITIONS) {
                parse_position(net, position);
            }
        }
    }

    if (utils.has_nonempty_array(config, "POSITIONS")) {
        /* Global positions */
        positions_set_manually = true;
        for (const position of config.POSITIONS) {
            parse_position(net, position);
        }
    }

    // Call generate network in case the positions have not been specifed already
    if (!positions_set_manually) {
        /* Generate the positions using a positioning method */
        const positions = generate_network(net.nodes.size);
        if (positions) {
            for (let i = 0; i < net.nodes.size; ++i) {
                const node = net.get_node(i + 1);
                node.pos_x = positions[i].pos_x;
                node.pos_y = positions[i].pos_y;
                log.log(log.INFO, node, "Main", `set position x=${node.pos_x.toFixed(2)} y=${node.pos_y.toFixed(2)}[SIMULATOR]`);
            }
        }
    }

    if (!nodes_set_manually) {
        /* Generate default some packet sources for a data collection application */
        for (let i = 2; i <= net.nodes.size; ++i) {
            /* packet sources */
            // log.log(log.INFO, net.get_node(i), "Main", `New Packet Source Node: ${net.get_node(i).id} to Destination: 1 [SIMULATOR]`);
            new ps.PacketSource(net.get_node(i), net.get_node(1));
        }
    }


    /* Set up connections and application packet sources */
    for (const from_node_type of config.NODE_TYPES) {
        if (!check_node_type_validity(from_node_type)) {
            continue;
        }

        if (utils.has_nonempty_array(from_node_type, "CONNECTIONS")) {
            
            connections_set_manually = true;
            types_with_connections_out[from_node_type.NAME] = true;

            if (config.TRACE_FILE) {
                log.log(log.WARNING, null, "Main", `ignoring connections for node type "${from_node_type.NAME}": trace file supplied[SIMULATOR]`);
                continue;
            }

            /* Connections defined for the node type */
            for (const connection of from_node_type.CONNECTIONS) {
                const TO_NODE_TYPE = ("NODE_TYPE" in connection) ? connection["NODE_TYPE"] : connection["TO_NODE_TYPE"];
                if (!(TO_NODE_TYPE in type_ids)) {
                    log.log(log.WARNING, null, "Main", `ignoring connections with unknown node type "${TO_NODE_TYPE}"[SIMULATOR]`);
                    continue;
                }
                types_with_connections_in[TO_NODE_TYPE] = true;
                const from = type_ids[from_node_type.NAME];
                const to = type_ids[TO_NODE_TYPE];
                for (let from_node_id of from) {
                    for (let to_node_id of to) {
                        if (from_node_id !== to_node_id) {
                            // Use the link model class to create link
                            const link = link_model.create_link(
                                net.get_node(from_node_id), net.get_node(to_node_id), connection);
                            // Add links to network
                            net.add_link(link);
                        }
                    }
                }
            }
        }

        // App packets is a sub array in NODE_TYPES in config.json
        if ("APP_PACKETS" in from_node_type) {
            const data = from_node_type.APP_PACKETS;
            // Set app packet configurations
            const period_sec = "APP_PACKET_PERIOD_SEC" in data ? data.APP_PACKET_PERIOD_SEC : config.APP_PACKET_PERIOD_SEC; // Time interval between application packets
            const size = "APP_PACKET_SIZE" in data ? data.APP_PACKET_SIZE : config.APP_PACKET_SIZE; // Application packets size
            const warmup_period = "APP_WARMUP_PERIOD_SEC" in data ? data.APP_WARMUP_PERIOD_SEC : config.APP_WARMUP_PERIOD_SEC; // Time to wait before sending the application packet after it is generated

            const is_query = "IS_QUERY" in data ? data.IS_QUERY : false;
            // If TO_TYPE exists in APP_PACKETS data, that is if destination node has a type and the generated app packet is to be sent to all nodes of those type [stored in to_type_id]
            if ("TO_TYPE" in data) {
                const to_type = data.TO_TYPE;
                for (let to_node_id of type_ids[to_type]) {
                    for (let from_node_id of type_ids[from_node_type.NAME]) {
                        /* generate packets only if the source is distinct from the destination */
                        if (from_node_id !== to_node_id) {
                            new ps.PacketSource(net.get_node(from_node_id),
                                                net.get_node(to_node_id),
                                                period_sec, false, is_query, size, warmup_period);
                        }
                    }
                }
            } else {
                const to_node_id = "TO_ID" in data ? data["TO_ID"] : constants.ROOT_NODE_ID;
                if (to_node_id === -1 || is_valid_node_id(net, to_node_id)) {
                    for (let from_node_id of type_ids[from_node_type.NAME]) {
                        /* generate packets only if the source is distinct from the destination */
                        if (from_node_id !== to_node_id) {
                            new ps.PacketSource(net.get_node(from_node_id),
                                                to_node_id === -1 ? null : net.get_node(to_node_id),
                                                period_sec, false, is_query, size, warmup_period);
                        }
                    }
                } else {
                    log.log(log.WARNING, null, "Main", `application packet specification: invalid to node ID "${to_node_id}"[SIMULATOR]`);
                }
            }
        }
    }

    /* Globally specified connections */
    if (utils.has_nonempty_array(config, "CONNECTIONS")) {
        connections_set_manually = true;

        for (const connection of config.CONNECTIONS) {
            const to_node_id = connection["FROM_ID"];
            const from_node_id = connection["TO_ID"];
            const node_type = connection["NODE_TYPE"];
            let from_node_type = connection["FROM_NODE_TYPE"];
            let to_node_type = connection["TO_NODE_TYPE"];

            if (node_type !== undefined || from_node_type !== undefined || to_node_type !== undefined) {
                if (to_node_id !== undefined || from_node_id !== undefined) {
                    log.log(log.WARNING, null, "Main", `ignoring TO_ID/FROM_ID in connection configuration as *NODE_TYPE is specified[SIMULATOR]`);
                }
                if (node_type !== undefined) {
                    if (from_node_type !== undefined) {
                        log.log(log.WARNING, null, "Main", `ignoring FROM_NODE_TYPE in connection configuration as NODE_TYPE is specified[SIMULATOR]`);
                    }
                    if (to_node_type !== undefined) {
                        log.log(log.WARNING, null, "Main", `ignoring TO_NODE_TYPE in connection configuration as NODE_TYPE is specified[SIMULATOR]`);
                    }
                    from_node_type = node_type;
                    to_node_type = node_type;
                }

                if (!(from_node_type in type_ids)) {
                    log.log(log.WARNING, null, "Main", `ignoring connections from unknown node type "${from_node_type}"[SIMULATOR]`);
                    continue;
                }
                types_with_connections_out[from_node_type] = true;

                if (!(to_node_type in type_ids)) {
                    log.log(log.WARNING, null, "Main", `ignoring connections from unknown node type "${to_node_type}"[SIMULATOR]`);
                    continue;
                }
                types_with_connections_in[to_node_type] = true;

                for (let from_node_id of type_ids[from_node_type]) {
                    for (let to_node_id of type_ids[to_node_type]) {
                        if (from_node_id !== to_node_id) {
                            const link = link_model.create_link(
                                net.get_node(from_node_id), net.get_node(to_node_id), connection);
                            net.add_link(link);
                        }
                    }
                }
                continue;
            }

            if (!is_valid_node_id(net, to_node_id)) {
                log.log(log.WARNING, null, "Main", `ignoring connection to node ${to_node_id}: no such node[SIMULATOR]`);
            } else if (!is_valid_node_id(net, from_node_id)) {
                log.log(log.WARNING, null, "Main", `ignoring connection from node ${from_node_id}: no such node[SIMULATOR]`);
            } else if (from_node_id === to_node_id) {
                log.log(log.WARNING, null, "Main", `ignoring connection from node ${from_node_id} to itself[SIMULATOR]`);
            } else {
                const link = link_model.create_link(
                    net.get_node(from_node_id), net.get_node(to_node_id), connection);
                net.add_link(link);
            }
        }
    }

    if (connections_set_manually) {
        for (let type in type_ids) {
            if (!types_with_connections_out[type]
                && !types_with_connections_in[type]) {
                log.log(log.WARNING, null, "Main", `no connections defined for node type "${type}"[SIMULATOR]`);
            }
            else if (!types_with_connections_out[type]) {
                log.log(log.WARNING, null, "Main", `no outgoing connections defined for node type "${type}"[SIMULATOR]`);
            }
            else if (!types_with_connections_in[type]) {
                log.log(log.WARNING, null, "Main", `no incoming connections defined for node type "${type}"[SIMULATOR]`);
            }
        }
    } else if (!config.TRACE_FILE) {
        /* No trace file and no manual connections; set up connections */
        const connection = { LINK_MODEL: "LogisticLoss" };
        for (let i = 1; i <= net.nodes.size; ++i) {
            for (let j = i + 1; j <= net.nodes.size; ++j) {
                const n1 = net.get_node(i);
                const n2 = net.get_node(j);
                net.add_link(link_model.create_link(n1, n2, connection));
                net.add_link(link_model.create_link(n2, n1, connection));
            }
        }
    }

    /* check the validity of the configurations */
    for (let [_, node] of net.nodes) {
        check_node_validity(node);
    }

    /* run the user's script, if any provided */
    if (config.SIMULATION_SCRIPT_FILE) {
        let filedata = "";
        let filename = config.SIMULATION_SCRIPT_FILE;
        if (!path.isAbsolute(filename)) {
            filename = path.join(path.dirname(config.CONFIG_FILE), config.SIMULATION_SCRIPT_FILE);
        }
        try {
            filedata = fs.readFileSync(filename, 'utf8');
        } catch (x) {
            log.log(log.ERROR, null, "Main", `failed to read the user script file ${config.SIMULATION_SCRIPT_FILE}: ${x}[SIMULATOR]`);
        }

        try {
            let func = new Function("state", filedata);
            let callbacks = func.call(null, state);
            if (callbacks) {
                state.callbacks = callbacks;
            } else {
                log.log(log.WARNING, null, "Main", `the user script did not return any callbacks[SIMULATOR]`);
            }
        } catch (x) {
            log.log(log.ERROR, null, "Main", `failed to evaluate the user script from file ${config.SIMULATION_SCRIPT_FILE}: ${x}[SIMULATOR]`);
        }
    }

    log.log(log.INFO, null, "Main", `simulation created[SIMULATOR]`);

    return net;
}

function start_simulation(network)
{
    state.is_running = true;
    state.is_reset_requested = false;
    log.log(log.INFO, null, "Main", `starting simulation main loop...[SIMULATOR]`);

    /* initialize all nodes */
    for (let [_, node] of network.nodes) {
        node.initialize();
    }
}

function finish_simulation(network)
{
    log.log(log.INFO, null, "Main", `ending simulation at ${time.timeline.seconds.toFixed(3)} seconds[SIMULATOR]`);
    /* get stats */
    const stats = network.aggregate_stats();
    /* write to a file, if needed */
    if (config.SAVE_RESULTS) {
        let filename;
        const is_child = config.SIMULATION_RUN_ID !== 0;

        filename = "stats";
        if (is_child) {
            filename += `_${config.SIMULATION_RUN_ID}`;
        }
        filename += ".json";
        fs.writeFileSync(path.join(dirnames.results_dir, filename), JSON.stringify(stats, null, 2));

        let s = "digraph time_source_tree {\n";
        s += '  rankdir="BT";\n';
        const tree = network.get_time_source_tree();
        const has_children = {};
        for (let id in tree) {
            if (tree[id] != null) {
                s += `  "${id}" -> "${tree[id]}";\n`;
                has_children[tree[id]] = true;
            }
        }

        /* parents */
        for (let id in has_children) {
            s += `  "${id}" [fillcolor="yellow" style="filled"];\n`;
        }

        /* root node */
        s += '  "1" [rank="source" fillcolor="#00FF7F" style="filled"];\n';

        s += '}\n';

        filename = "time_source_tree";
        if (is_child) {
            filename += `_${config.SIMULATION_RUN_ID}`;
        }
        filename += ".dot";
        fs.writeFileSync(path.join(dirnames.results_dir, filename), s);
    }
}

/* run a single simulation taking the network configuration as the input */
export function run_simulation(network)
{
    start_simulation(network);

    /* deal with rounding errors in a quick and dirty way */
    const end_time_sec = config.SIMULATION_DURATION_SEC + 0.000001;

    while (state.is_running) {
        /* have we reached the end of the simulation time? */
        if (time.timeline.get_next_seconds() > end_time_sec) {
            state.is_running = false;
            break;
        }

        /* execute the periodic processing */
        time.timeline.step();
        status.simulator.asn = time.timeline.asn;
        const cb = state.callbacks[time.timeline.asn];
        if (cb) {
            cb(state);
        }
        network.step(false);
    }

    finish_simulation(network);
}

/* run a looping function waiting for commands and execute (parts of) simulations on request */
export async function run_interactive()
{
    while (true) {
        /* log.log(log.INFO, null, "Main", `entering the infinite loop...`); */

        let network = construct_simulation(true);
        let old_config = JSON.stringify(config);

        state.is_reset_requested = false;
        while (!state.is_running) {
            /* log.log(log.INFO, null, "Main", `waiting for a start command...`); */
            await utils.sleep(50);

            /* check if the config has changed */
            const new_config = JSON.stringify(config);
            if (new_config != old_config) {
                /* if it has changed, rebuild the simulation */
                old_config = new_config;
                network = construct_simulation(true);
            }
        }

        start_simulation(network);

        let is_simulation_finished = false;

        /* for all duration of the simulation loop */
        while (!state.is_reset_requested) {

            const start_real_seconds = process.uptime();
            const start_simulated_seconds = time.timeline.seconds;
            let has_advanced = false;
            state.is_interrupt_requested = false;

            /* deal with rounding errors in a quick and dirty way */
            const end_time_sec = config.SIMULATION_DURATION_SEC + 0.000001;

            /* while actively running the simulation loop */
            while (state.is_running && !state.is_interrupt_requested) {
                is_simulation_finished = false;

                /* have we reached the end of the simulation time? */
                if (time.timeline.get_next_seconds() > end_time_sec) {
                    state.is_running = false;
                    break;
                }

                has_advanced = true; /* we have taken at least one step */

                /* execute the periodic processing */
                time.timeline.step();
                status.simulator.asn = time.timeline.asn;
                const cb = state.callbacks[time.timeline.asn];
                if (cb) {
                    cb(state);
                }

                /* make a single step in the network simulation */
                const step = network.step(true);

                /* add the current timeslot actions and transmissions to the web interface data */
                if (status.schedule.length >= config.WEB_MAX_CELLS) {
                    status.schedule.shift();
                }

                // Add time and cells returned by the network step method
                status.schedule.push({
                    asn: time.timeline.asn,
                    seconds: time.timeline.seconds,
                    cells: step.schedule_status
                });
                delete status.network.transmissions[time.timeline.asn - config.WEB_MAX_CELLS];
                if (step.transmissions.length) {
                    status.network.transmissions[time.timeline.asn] = step.transmissions;
                }

                /* have we reached a pause condition? */
                switch (state.simulation_speed) {
                case constants.RUN_UNLIMITED:
                default:
                {
                    const real_world_seconds = process.uptime() - start_real_seconds;
                    if (real_world_seconds > 1.0) {
                        /* interrupt this inner loop once per second to react to new commands */
                        state.is_interrupt_requested = true;
                    }
                }
                    break;
                case constants.RUN_1000_PERCENT:
                case constants.RUN_100_PERCENT:
                case constants.RUN_10_PERCENT:
                {
                    const real_world_seconds = process.uptime() - start_real_seconds;
                    const simulated_seconds = time.timeline.seconds - start_simulated_seconds;
                    const coeff = state.simulation_speed === constants.RUN_10_PERCENT ? 10.0
                          : (state.simulation_speed === constants.RUN_100_PERCENT ? 1.0 : 0.1);
                    let delta = coeff * simulated_seconds - real_world_seconds;
                    if (delta >= 0.001) {
                        /* do not allow to sleep for too long and become completely unresponsive */
                        delta = Math.min(delta, 10.0);
                        await utils.sleep(delta * 1000);
                    }
                }
                    break;
                case constants.RUN_STEP_NEXT_ACTIVE:
                    if (step.was_active_slot) {
                        state.is_running = false;
                    }
                    break;
                case constants.RUN_STEP_SINGLE:
                    state.is_running = false;
                    break;
                }
            }

            state.is_interrupt_requested = false;

            if (time.timeline.get_next_seconds() > end_time_sec) {
                if (!is_simulation_finished) {
                    is_simulation_finished = true;
                    if (has_advanced) {
                        finish_simulation(network);
                    } else {
                        log.log(log.INFO, null, "Main", `already at the end of configured time limit of ${time.timeline.seconds.toFixed(3)} seconds...[SIMULATOR]`);
                    }
                }
            }

            if (!state.is_reset_requested) {
                /* sleep some short time and wait for more commands */
                await utils.sleep(has_advanced ? 0 : 100);
            }
        }

        if (!is_simulation_finished) {
            finish_simulation(network);
        }
    }
}

export function has_simulation_ended()
{
    const end_time_sec = config.SIMULATION_DURATION_SEC + 0.000001;
    return time.timeline.get_next_seconds() > end_time_sec;
}

export function run_single()
{
    let network = construct_simulation(false);
    run_simulation(network);
}

export function get_nodes()
{
    return state.network.nodes;
}

export function get_status()
{
    status.simulator.is_running = state.is_running;
    status.simulator.asn = state.timeline ? state.timeline.asn : 0;
    status.simulator.seconds = state.timeline ? state.timeline.seconds : 0;
    status.network.nodes = [];
    status.network.links = {};
    if (state.network) {
        /* save the nodes positions */
        for (const [id, node] of state.network.nodes) {
            status.network.nodes.push({id,
                                       x: node.pos_x,
                                       y: node.pos_y});
        }
        /* save the link qualities */
        for (let [link_key, link] of state.network.links) {
            const success_rate = link.get_average_success_rate();
            /* add only >0.0% links */
            if (success_rate > 0.0) {
                status.network.links[link_key] = success_rate;
            }
        }
    }

    /* write the status to a file (for debugging) */
    fs.writeFileSync(path.join(dirnames.self_dir, "status.json"), JSON.stringify(status, null, 2));

    return status;
}

export function update_node_positions(node_positions)
{
    if (!state.network) {
        log.log(log.WARNING, null, "Main", `update positions: network not present[SIMULATOR]`);
        return;
    }

    for (let i = 0; i < node_positions.length; i++) {
        const id = node_positions[i].ID;
        const node = state.network.find_node(id);
        if (!node) {
            log.log(log.INFO, null, "Main", `update positions: cannot find node by id=${id}[SIMULATOR]`);
            continue;
        }
        node.pos_x = node_positions[i].X;
        node.pos_y = node_positions[i].Y;
        state.network.update_node_links(node);
    }
}

export const state = {
    is_running: false,
    is_reset_requested: false,
    is_interrupt_requested: false,
    simulation_speed: constants.RUN_UNLIMITED,
    network: null,
    scheduler: null,
    routing: null,
    config: null,
    timeline: null,
    log: null,
    ps: null,
    pkt: null,
    constants: null,
    callbacks: {}
};
