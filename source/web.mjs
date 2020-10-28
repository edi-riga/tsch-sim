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
import * as log from './log.mjs';
import * as simulator from './simulator.mjs';

import Express from 'express';
import BodyParser from 'body-parser';

let initial_config = null;

/*---------------------------------------------------------------------------*/

function make_test_status()
{
    const NUM_NODES = 10;
    /* add some nodes */
    status.network.nodes = [];
    for (let j = 0; j < NUM_NODES; j++) {
        status.network.nodes.push({x: 0, y: 0, id: j + 1})
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

        status.schedule.push({ asn: i, seconds: 12.34 + i / 100.0, cells: s });
    }


    /* add some logs */
    for (let i = 0; i < config.WEB_MAX_LOGS; i++) {
        log.log(log.INFO, null, "Main", "Hello world " + i);
    }
}

/*---------------------------------------------------------------------------*/

function start()
{
    let app = Express();

    /* make a copy of the config at the point of start */
    initial_config = JSON.parse(JSON.stringify(config));

    app.use(function(req, res, next) {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
        next();
    });

    app.use(BodyParser.urlencoded({ extended: false }));
    app.use(BodyParser.json());

    app.get('/cmdrun.json', (req, res, next) => {
        log.log(log.INFO, null, "Main", "run requested");

        let speed = constants.RUN_UNLIMITED;
        try {
            if (req.query.speed) {
                speed = parseInt(req.query.speed);
            }
        } catch (x) {
            log.log(log.WARNING, null, "Main", `ignoring invalid speed limit argument ${req.query.speed}`);
        }
        if (speed < constants.RUN_UNLIMITED || speed > constants.RUN_STEP_SINGLE) {
            log.log(log.WARNING, null, "Main", `unknown speed limit ${speed}, using unlimited speed`);
            speed = constants.RUN_UNLIMITED;
        }

        if (!simulator.state.is_running) {
            log.log(log.DEBUG, null, "Main", "run: reply ok");
            res.json({status: "ok"});
            /* if the simulation has already finished, reset it first */
            if (simulator.has_simulation_ended()) {
                simulator.state.is_reset_requested = true;
            }
            /* start the simulator */
            simulator.state.simulation_speed = speed;
            simulator.state.is_running = true;
        } else {
            log.log(log.INFO, null, "Main", "run: already running");
            res.json({status: "already running"});
            if (simulator.state.simulation_speed !== speed) {
                /* reconfigure the speed */
                simulator.state.simulation_speed = speed;
                simulator.state.is_interrupt_requested = true;
                log.log(log.INFO, null, "Main", "set the new speed");
            }
        }
    })

    app.get('/cmdpause.json', (req, res, next) => {
        log.log(log.INFO, null, "Main", "pause requested");
        if (simulator.state.is_running) {
            res.json({status: "ok"});
        } else {
            log.log(log.INFO, null, "Main", "pause: not running");
            res.json({status: "not running"});
        }
        simulator.state.is_running = false;
    })

    app.get('/cmdreset.json', (req, res, next) => {
        log.log(log.INFO, null, "Main", `reset requested on ${simulator.state.is_running ? "running" : "stopped"} simulator`);
        simulator.state.is_reset_requested = true;
        /* need to stop it, otherwise the engine will not notice */
        simulator.state.is_running = false;
        res.json({status: "ok"});
    })

    app.get('/status.json', (req, res, next) => {
        /* log.log(log.DEBUG, null, "Main", `status requested`); */
        /* make_test_status(); */
        res.json(simulator.get_status());
    })

    app.get('/results.json', (req, res, next) => {
        log.log(log.INFO, null, "Main", "results requested");
        /* export the stats and return them */
        if (simulator.state.network) {
            res.json(simulator.state.network.aggregate_stats());
        } else {
            /* not created yet, nothing to do */
            res.json({});
        }
    })

    app.post('/config.json', (req, res, next) => {
        log.log(log.INFO, null, "Main", "new config received");

        const web_config = req.body;

        /* reinitialize the main config with the initial values */
        for (let key in initial_config) {
            config[key] = initial_config[key];
        }

        /* override the initial values with the ones supplied by the user */
        for (let key in web_config) {
            config[key] = web_config[key];
        }

        /* we must be running the web interface */
        config.WEB_ENABLED = true;

        /* stop and reset the simulation, if any */
        simulator.state.is_running = false;
        simulator.state.is_reset_requested = true;

        res.json({status: "ok"});
    });

    app.post('/positions.json', (req, res, next) => {
        log.log(log.DEBUG, null, "Main", "new node positions received");
        const node_positions = req.body;
        simulator.update_node_positions(node_positions);
        res.json({status: "ok"});
    });

    /* static files */
    app.use('/', Express.static('web'))

    /* icon */
    app.use('/favicon.ico', Express.static('web/images/favicon.ico'));

    app.listen(config.WEB_PORT);
}

/*---------------------------------------------------------------------------*/

let web = {
    start
};

export default web;
