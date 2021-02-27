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
 *         Backend of the web interface, based on the Express framework.
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import constants from './constants.mjs';
import config from './config.mjs';
import dirnames from "./dirnames.mjs";
import * as log from './log.mjs';
import * as simulator from './simulator.mjs';

import * as http from 'http';
import * as url from 'url';
import * as fs from 'fs';
import path from 'path';

let initial_config = null;

const HEADERS = {
    'Content-Type': 'application/json',
    "Access-Control-Allow-Origin" : "*",
    "Access-Control-Allow-Headers" : "Origin, X-Requested-With, Content-Type, Accept"
};

/* file types served statically */
const MIME_TYPE = {
    '.html' : 'text/html',
    '.otf' : 'font/otf',
    '.eot' : 'application/vnd.ms-fontobject',
    '.ttf' : 'font/ttf',
    '.woff' : 'font/woff',
    '.css' : 'text/css',
    '.js' : 'text/javascript',
    '.svg' : 'image/svg+xml',
    '.ico' : 'image/ico',
    '.png' : 'image/png',
};

/*---------------------------------------------------------------------------*/

function make_test_status()
{
    const NUM_NODES = 10;
    /* add some nodes */
    status.network.nodes = [];
    for (let j = 0; j < NUM_NODES; j++) {
        status.network.nodes.push({x: 0, y: 0, id: j + 1});
    }

    /* add some cells */
    for (let i = 0; i < config.WEB_MAX_CELLS; i++) {
        const asn = i + 1234;

        const s = [];
        for (let j = 0; j < NUM_NODES; j++) {

            s.push({});
            if (i === j) {
                s[j].flags = constants.FLAG_TX | constants.FLAG_PACKET_TX;
                s[j].from = i;
                s[j].to = i + 1;
                s[j].l = 100;
            } else if (i + 1 === j) {
                s[j].flags = constants.FLAG_RX | constants.FLAG_PACKET_RX;
                s[j].from = i;
                s[j].to = j;
                s[j].l = 100;
            } else {
                s[j].flags = constants.FLAG_RX;
            }
            s[j].co = 0;
            s[j].ch = 26;
        }

        status.schedule.push({ asn: asn, seconds: 12.34 + i / 100.0, cells: s });
    }


    /* add some logs */
    for (let i = 0; i < config.WEB_MAX_LOGS; i++) {
        log.log(log.INFO, null, "Main", "Hello world " + i);
    }
}

/*---------------------------------------------------------------------------*/

function serve_run(req, res)
{
    log.log(log.INFO, null, "Main", "run requested");

    const q = url.parse(req.url, true);
    let result;
    let speed = constants.RUN_UNLIMITED;
    try {
        if (q.query.speed) {
            speed = parseInt(q.query.speed);
        }
    } catch (x) {
        log.log(log.WARNING, null, "Main", `ignoring invalid speed limit argument ${q.query.speed}`);
    }
    if (speed < constants.RUN_UNLIMITED || speed > constants.RUN_STEP_SINGLE) {
        log.log(log.WARNING, null, "Main", `unknown speed limit ${speed}, using unlimited speed`);
        speed = constants.RUN_UNLIMITED;
    }

    if (!simulator.state.is_running) {
        log.log(log.DEBUG, null, "Main", "run: reply ok");
        result = {status: "ok"};
        /* if the simulation has already finished, reset it first */
        if (simulator.has_simulation_ended()) {
            simulator.state.is_reset_requested = true;
        }
        /* start the simulator */
        simulator.state.simulation_speed = speed;
        simulator.state.is_running = true;
    } else {
        log.log(log.INFO, null, "Main", "run: already running");
        result = {status: "already running"};
        if (simulator.state.simulation_speed !== speed) {
            /* reconfigure the speed */
            simulator.state.simulation_speed = speed;
            simulator.state.is_interrupt_requested = true;
            log.log(log.INFO, null, "Main", "set the new speed");
        }
    }

    serve_success(res, result);
}

function serve_pause(req, res)
{
    log.log(log.INFO, null, "Main", "pause requested");

    let result;
    if (simulator.state.is_running) {
        result = {status: "ok"};
    } else {
        log.log(log.INFO, null, "Main", "pause: not running");
        result = {status: "not running"};
    }
    simulator.state.is_running = false;

    serve_success(res, result);
}

function serve_reset(req, res)
{
    log.log(log.INFO, null, "Main", `reset requested on ${simulator.state.is_running ? "running" : "stopped"} simulator`);
    simulator.state.is_reset_requested = true;
    /* need to stop it, otherwise the engine will not notice */
    simulator.state.is_running = false;

    const result = {status: "ok"};
    serve_success(res, result);
}

function serve_status(req, res)
{
    /* log.log(log.DEBUG, null, "Main", `status requested`); */
    /* make_test_status(); */
    const result = simulator.get_status();
    serve_success(res, result);
}

function serve_results(req, res)
{
    let result;

    log.log(log.INFO, null, "Main", "results requested");
    /* export the stats and return them */
    if (simulator.state.network) {
        result = simulator.state.network.aggregate_stats();
    } else {
        /* not created yet, nothing to do */
        result = {};
    }

    serve_success(res, result);
}

function serve_config(req, res, body)
{
    log.log(log.INFO, null, "Main", "new config received");

    /* reinitialize the main config with the initial values */
    for (let key in initial_config) {
        config[key] = initial_config[key];
    }

    /* override the initial values with the ones supplied by the user */
    const web_config = body;
    for (let key in web_config) {
        config[key] = web_config[key];
    }

    /* we must be running the web interface */
    config.WEB_ENABLED = true;

    /* stop and reset the simulation, if any */
    simulator.state.is_running = false;
    simulator.state.is_reset_requested = true;

    const result = {status: "ok"};
    serve_success(res, result);
}

function serve_positions(req, res, body)
{
    log.log(log.DEBUG, null, "Main", "new node positions received");
    const node_positions = body;
    simulator.update_node_positions(node_positions);

    const result = {status: "ok"};
    serve_success(res, result);
}

function get_mime_type(filename)
{
    let result;

    const ext = path.extname(filename).toLowerCase();
    if (ext in MIME_TYPE) {
        result = MIME_TYPE[ext];
    } else {
        log.log(log.WARNING, null, "Main", `web: requested a file with unknown extension "${ext}"`);
        result = "text/plain";
    }

    return result;
}

function serve_file(req, res, q)
{
    let pathname = q.pathname;
    if (pathname == null || pathname === "" || pathname === "/") {
        pathname = "index.html";
    }

    const web_directory = path.join(dirnames.self_dir, "..", "web");
    const filename = path.join(web_directory, pathname);

    /* trying to sneak out of the web directory? */
    if (filename.indexOf(web_directory) !== 0) {
        const errmsg = `web: attempted to get a file outside the web directory: "${filename}"`;
        log.log(log.ERROR, null, "Main", errmsg);
        serve_error(req, res, 404, JSON.stringify(errmsg));
        return;
    }

    /* copy the default headers, but update the mime type */
    const updated_headers = {};
    for (let key in HEADERS) {
        updated_headers[key] = HEADERS[key];
    }
    updated_headers['Content-Type'] = get_mime_type(filename);

    fs.readFile(filename, function (err, data) {
        if (err) {
            /* 404 Not Found */
            const errmsg = `web: file cannot be read: "${filename}"`;
            log.log(log.ERROR, null, "Main", errmsg);
            serve_error(req, res, 404, JSON.stringify(errmsg));
            return;
        }
        /* 200 OK */
        res.writeHead(200, updated_headers);
        res.end(data);
    });
}

function serve_get(req, res)
{
    const q = url.parse(req.url, true);

    if (q.pathname === "/cmdrun.json") {
        serve_run(req, res);
    } else if (q.pathname === "/cmdpause.json") {
        serve_pause(req, res);
    } else if (q.pathname === "/cmdreset.json") {
        serve_reset(req, res);
    } else if (q.pathname === "/status.json") {
        serve_status(req, res);
    } else if (q.pathname === "/results.json") {
        serve_results(req, res);
    } else {
        /* by default, attempt to find a file with the right name */
        serve_file(req, res, q);
    }
}

function serve_post(req, res)
{
    const q = url.parse(req.url, true);

    if (q.pathname !== "/config.json" && q.pathname !== "/positions.json") {
        log.log(log.ERROR, null, "Main", `web: URL not found or POST not supported, URL="${q.pathname}"`);
        serve_error(req, res, 404, JSON.stringify({error: "Not Found"}));
        return;
    }

    let body = "";
    req.on('data', function (data) {
        body += data;

        /* If too much POST data (>1GB), kill the connection */
        if (body.length > 1e9) {
            req.connection.destroy();
        }
    });

    req.on('end', function () {
        /* If too much POST data (>1GB), don't attempt to process it */
        if (body.length > 1e9) {
            /* 413 Payload Too Large */
            log.log(log.ERROR, null, "Main", `web: POST payload too large`);
            serve_error(req, res, 413, JSON.stringify({error: "Too Large"}));
            return;
        }

        let json_body;
        try {
            json_body = JSON.parse(body);
        } catch (x) {
            /* 400 Bad Request */
            log.log(log.ERROR, null, "Main", `web: parsing JSON failed, URL="${q.pathname}"`);
            serve_error(req, res, 400, JSON.stringify({error: "Parsing JSON failed"}));
            return;
        }

        /* received and parsed successfully, call the functions */
        if (q.pathname === "/config.json") {
            serve_config(req, res, json_body);
        } else if (q.pathname === "/positions.json") {
            serve_positions(req, res, json_body);
        }
    });
}

function serve_success(res, response)
{
    /* 200 OK */
    res.writeHead(200, HEADERS);
    res.write(JSON.stringify(response));
    res.end();
}

function serve_error(req, res, code, message)
{
    res.writeHead(code, HEADERS);
    res.write(message);
    res.end();
}

function start()
{
    /* make a copy of the config at the point of start */
    initial_config = JSON.parse(JSON.stringify(config));

    http.createServer(function (req, res) {
        if (req.method === "GET") {
            serve_get(req, res);
        } else if (req.method === "POST") {
            serve_post(req, res);
        } else {
            /* 405 Method Not Allowed */
            log.log(log.ERROR, null, "Main", `web: unknown method ${req.method}`);
            serve_error(req, res, 405, "Unknown method");
        }
    }).listen(config.WEB_PORT);
}

/*---------------------------------------------------------------------------*/

let web = {
    start
};

export default web;
