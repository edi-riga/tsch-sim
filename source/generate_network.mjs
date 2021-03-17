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
 *         Network generator: generates networks with different topologies.
 *         Supported topologies: star, line, grid, mesh (with configurable density).
 *         Only the logistic-loss link model is supported.
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import config from './config.mjs';
import * as log from './log.mjs';
import { get_node_distance } from './utils.mjs';
import { rng } from './random.mjs';

import dirnames from "./dirnames.mjs";
import fs from 'fs';
import path from 'path';

function get_rssi(n1, n2)
{
    let d = get_node_distance(n1, n2);
    if (d <= 0) {
        /* do not allow the distance to be zero */
        d = 0.01;
    } else if (d >= config.LOGLOSS_TRANSMIT_RANGE_M) {
        /* no chance of reception */
        return config.LOGLOSS_RX_SENSITIVITY_DBM;
    }
    
    const path_loss_dbm = -config.LOGLOSS_RX_SENSITIVITY_DBM
          + 10 * config.LOGLOSS_PATH_LOSS_EXPONENT * Math.log10(d / config.LOGLOSS_TRANSMIT_RANGE_M);
    return config.TX_POWER_DBM - path_loss_dbm;
}

/* inverse of `get_rssi` */
function distance_from_rssi(rssi)
{
    if (rssi <= config.LOGLOSS_RX_SENSITIVITY_DBM) {
        return config.LOGLOSS_TRANSMIT_RANGE_M;
    }
    const path_loss_dbm = rssi + config.TX_POWER_DBM;
    const noise_to_signal = config.LOGLOSS_RX_SENSITIVITY_DBM - path_loss_dbm;
    const relative_distance = Math.pow(10, noise_to_signal / (10 * config.LOGLOSS_PATH_LOSS_EXPONENT));
    /* log.log(log.INFO, null, "Main", `path_loss_dbm=${path_loss_dbm} noise_to_signal=${noise_to_signal} d=${relative_distance * config.LOGLOSS_TRANSMIT_RANGE_M}`); */
    return relative_distance * config.LOGLOSS_TRANSMIT_RANGE_M;
}

function link_quality(n1, n2)
{
    const rssi = get_rssi(n1, n2);
    const x = rssi - config.LOGLOSS_RSSI_INFLECTION_POINT_DBM;
    const success_rate = 1.0 / (1.0 + Math.exp(-x));
    return { success_rate, rssi };
}

/* inverse of `link_quality` */
function distance_from_link_quality(lq)
{
    const logit = Math.log(lq / (1 - lq));
    const rssi = logit + config.LOGLOSS_RSSI_INFLECTION_POINT_DBM;
    /* log.log(log.INFO, null, "Main", `q=${lq} logit=${logit} rssi=${rssi}`); */
    return distance_from_rssi(rssi);
}

function initialize_random(num_nodes, area_radius)
{
    const nodes = [];
    /* first, add the gateway at the center */
    nodes.push({pos_x: 0.0, pos_y: 0.0, distance: 0.0, angle: 0.0});
    for (let i = 1; i < num_nodes; ++i) {
        const u = rng.random();
        /* to ensure uniform distribution in the circle, make nodes quadratically more likely to be in the outer rings */
        const distance = area_radius - u * u * area_radius;
        const angle = rng.random() * Math.PI * 2;
        const pos_x = distance * Math.sin(angle);
        const pos_y = distance * Math.cos(angle);
        nodes.push({pos_x, pos_y, distance, angle});
    }
    return nodes;
}

function get_degrees_links(nodes)
{
    let i;
    const links = {};
    const num_links_per_node = {};
    let num_good_links = 0;
    for (i = 0; i < nodes.length; ++i) {
        num_links_per_node[i] = 0;
    }
    for (i = 0; i < nodes.length; ++i) {
        const n1 = nodes[i];
        for (let j = i + 1; j < nodes.length; ++j) {
            const n2 = nodes[j];
            const link = link_quality(n1, n2);
            if (link.success_rate >= config.POSITIONING_LINK_QUALITY) {
                const key = i * nodes.length + j;
                links[key] = link;
                num_good_links += 1;
                num_links_per_node[i] += 1;
                num_links_per_node[j] += 1;
            }
        }
    }
    let num_disconnected = 0;
    for (i = 0; i < nodes.length; ++i) {
        if (num_links_per_node[i] === 0) {
            num_disconnected += 1;
        }
    }
    
    const degrees = 2 * num_good_links / nodes.length;
    return { degrees, links, num_disconnected, num_links_per_node };
}

function connect_node(nodes, num_links_per_node)
{
    let i;
    let connected_node = null;
    let disconnected_node = null;
    for (i = nodes.length - 1; i >= 0; --i) {
        if (num_links_per_node[i] === 0) {
            disconnected_node = i;
        } else {
            connected_node = i;
        }
        if (connected_node != null && disconnected_node != null) {
            break;
        }
    }

    if (connected_node != null && disconnected_node != null) {
        /* move the disconnected node to a position where it has a link at least to the connected node */
        const delta = rng.random() * (config.LOGLOSS_TRANSMIT_RANGE_M / 3);
        nodes[disconnected_node].distance = nodes[connected_node].distance - delta;
        nodes[disconnected_node].angle = nodes[connected_node].angle;
        nodes[disconnected_node].pos_x = nodes[disconnected_node].distance * Math.sin(nodes[disconnected_node].angle);
        nodes[disconnected_node].pos_y = nodes[disconnected_node].distance * Math.cos(nodes[disconnected_node].angle);
    }
}

/*
 * Generate a random mesh network with a simple algorithm:
 * - initialize random positions depending on the number of links expected and on the network size
 * - while not meeting the constraints, keep moving nodes (further apart or closer together)
 */
function generate_mesh(num_nodes, degrees, initial_area_radius=null)
{
    log.log(log.INFO, null, "Main", `generating a mesh network with ${num_nodes} nodes and ${degrees} degrees`);

    const min_allowed_degrees = 2;
    if (degrees < min_allowed_degrees) {
        log.log(log.ERROR, null, "Main", `impossible to generate a mesh network with ${num_nodes} nodes and ${degrees} degrees: the network would be disconnected`);
        return null;
    }

    /* a node can have links up to N-1 other nodes */
    const max_possible_degrees = num_nodes - 1;
    if (degrees > max_possible_degrees) {
        log.log(log.ERROR, null, "Main", `impossible to generate a network with ${num_nodes} nodes and ${degrees} degrees: too many connections required`);
        return null;
    }

    /* relax the constraint a bit and accept values close to the required */
    const min_acceptable_degrees = Math.min(degrees - 0.5, degrees * 0.9);
    const max_acceptable_degrees = Math.max(degrees + 0.5, degrees * 1.1);

    if (!initial_area_radius) {
        initial_area_radius = Math.trunc(config.LOGLOSS_TRANSMIT_RANGE_M * Math.sqrt(num_nodes) * 3 / degrees);
    }

    let area_multiplier = 1.0;
    let nodes = initialize_random(num_nodes, area_multiplier * initial_area_radius);
    let net = get_degrees_links(nodes);
    log.log(log.INFO, null, "Main", `initialized, net.degrees=${net.degrees} range=[${min_acceptable_degrees},${max_acceptable_degrees}]`);

    while (!(min_acceptable_degrees <= net.degrees && net.degrees <= degrees)) {
        if (net.degrees < min_acceptable_degrees) {
            log.log(log.INFO, null, "Main", `increase degrees, current net.degrees=${net.degrees}`);
            area_multiplier /= 1.03;
        } else {
            log.log(log.INFO, null, "Main", `decrease degrees, current net.degrees=${net.degrees} area_multiplier=${area_multiplier}`);
            area_multiplier *= 1.03;
        }
        nodes = initialize_random(num_nodes, area_multiplier * initial_area_radius);
        net = get_degrees_links(nodes);
    }

    if (net.num_disconnected) {
        log.log(log.INFO, null, "Main", `trying to fix the generated network: some nodes are disconnected`);
    }

    /* try to fix disconnected nodes */
    while (net.num_disconnected) {
        /* save a copy of the current state first */
        const old_nodes = JSON.parse(JSON.stringify(nodes));
        connect_node(nodes, net.num_links_per_node);
        net = get_degrees_links(nodes);
        log.log(log.INFO, null, "Main", `connected a node, new net.degrees=${net.degrees}`);
        if (!(min_acceptable_degrees <= net.degrees && net.degrees <= max_acceptable_degrees)) {
            /* restore to previous version of nodes */
            log.log(log.ERROR, null, "Main", `failed to generate a connected network with ${num_nodes} nodes and ${degrees} degrees: some nodes remain disconnected`);
            nodes = old_nodes;
            break;
        }
    }

    return nodes;
}

function generate_star(num_nodes)
{
    log.log(log.INFO, null, "Main", `generating a star network with ${num_nodes} nodes`);

    const nodes = [];
    if (!num_nodes) {
        return nodes;
    }
    const radius = distance_from_link_quality(config.POSITIONING_LINK_QUALITY);
    nodes.push({pos_x: radius, pos_y: radius});
    for (let i = 1; i < num_nodes; ++i) {
        const angle = Math.PI * 2 * i / (num_nodes - 1);
        const pos_x = radius * (1 + Math.cos(angle));
        const pos_y = radius * (1 + Math.sin(angle));
        nodes.push({pos_x, pos_y});
    }
    return nodes;
}

function generate_line(num_nodes)
{
    log.log(log.INFO, null, "Main", `generating a line network with ${num_nodes} nodes`);

    const nodes = [];
    const step = distance_from_link_quality(config.POSITIONING_LINK_QUALITY);
    for (let i = 0; i < num_nodes; ++i) {
        const pos_x = i * step;
        const pos_y = 0;
        nodes.push({pos_x, pos_y});
    }
    return nodes;
}

function generate_grid(num_nodes)
{
    log.log(log.INFO, null, "Main", `generating a grid network with ${num_nodes} nodes`);

    const nodes = [];
    const step = distance_from_link_quality(config.POSITIONING_LINK_QUALITY);
    const per_row = Math.ceil(Math.sqrt(num_nodes));
    for (let i = 0; i < num_nodes; ++i) {
        const row = Math.trunc(i / per_row);
        const column = i - row * per_row;

        const pos_x = column * step;
        const pos_y = row * step;
        nodes.push({pos_x, pos_y});
    }
    return nodes;
}

function save_generated_network(nodes)
{
    const contents = {
        LOGLOSS_TRANSMIT_RANGE_M: config.LOGLOSS_TRANSMIT_RANGE_M,
        LOGLOSS_RX_SENSITIVITY_DBM: config.LOGLOSS_RX_SENSITIVITY_DBM,
        LOGLOSS_RSSI_INFLECTION_POINT_DBM: config.LOGLOSS_RSSI_INFLECTION_POINT_DBM,
        LOGLOSS_PATH_LOSS_EXPONENT: config.LOGLOSS_PATH_LOSS_EXPONENT,
        AWGN_GAUSSIAN_STD: config.AWGN_GAUSSIAN_STD,
        NODE_TYPES: [{
            NAME: "node",
            START_ID: 1,
            COUNT: nodes.length,
            CONNECTIONS: [{"NODE_TYPE": "node", "LINK_MODEL" : "LogisticLoss"}]
        }],
        POSITIONS: []
    };
    for (let i = 0; i < nodes.length; ++i) {
        contents.POSITIONS.push({ID: i + 1, X: nodes[i].pos_x, Y: nodes[i].pos_y});
    }

    const is_child = config.SIMULATION_RUN_ID !== 0;
    const filename = is_child ? `positions_${config.SIMULATION_RUN_ID}.json` : "positions.json";
    fs.writeFileSync(path.join(dirnames.results_dir, filename), JSON.stringify(contents, null, 2));
}

export default function generate_network(num_nodes)
{
    let result;

    if (config.POSITIONING_LAYOUT === "Star") {
        result = generate_star(num_nodes);
    } else if (config.POSITIONING_LAYOUT === "Line") {
        result = generate_line(num_nodes);
    } else if (config.POSITIONING_LAYOUT === "Grid") {
        result = generate_grid(num_nodes);
    } else if (config.POSITIONING_LAYOUT === "Mesh") {
        let num_degrees = config.POSITIONING_NUM_DEGREES;
        if (!num_degrees) {
            /* use sqrt(N) as the default number of degrees */
            num_degrees = Math.sqrt(num_nodes);
        }
        let old_random_seed;
        if (config.POSITIONING_RANDOM_SEED != null) {
            /* save the current state of the RNG */
            old_random_seed = rng.randint(0, 1000000);
            rng.seed(config.POSITIONING_RANDOM_SEED);
        }
        result = generate_mesh(num_nodes, num_degrees);
        if (config.POSITIONING_RANDOM_SEED != null) {
            /* restore the RNG seed */
            rng.seed(old_random_seed);
        }
    } else {
        log.log(log.ERROR, null, "Main", `unknown layout ${config.POSITIONING_LAYOUT}, ignoring; select one of: Mesh/Star/Line/Grid`);
        result = null;
    }

    if (config.SAVE_RESULTS) {
        /* write the result to a file */
        save_generated_network(result);
    }

    return result;
}
