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
 *         Main file: start the simulator
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import config from "./config.mjs";
import * as simulator from "./simulator.mjs";
import dirnames from "./dirnames.mjs";
import web from "./web.mjs";
import * as log from "./log.mjs";

import fs from 'fs';
import path from 'path';
import { fork } from 'child_process';
import process from 'process';

/* ------------------------------------- */

function main()
{
    /* are we in a child process? if so, save the ID */
    config.SIMULATION_RUN_ID = process.argv.length > 3 ? parseInt(process.argv[3]) : 0;
    if (isNaN(config.SIMULATION_RUN_ID)) {
        console.log("failed to parse simulation run ID, using 0");
        console.log(`  arguments=${JSON.stringify(process.argv)}`);
        config.SIMULATION_RUN_ID = 0;
    }

    const is_child = config.SIMULATION_RUN_ID !== 0;

    if (is_child) {
        /* use a different simulation seed for each child to avoid perfect replication of other runs */
        config.SIMULATION_SEED += config.SIMULATION_RUN_ID;
        /* use the same results dir as for the parent (passed as command line argument) */
        if (process.argv.length > 4) {
            dirnames.results_dir = process.argv[4];
        }
    }

    if (config.SAVE_RESULTS) {
        /* create the output directory */
        try {
            fs.mkdirSync(dirnames.results_dir, { recursive: true });
        } catch(x) {
            /* do nothing */
        }
    }

    if (config.LOG_FILE == null) {
        if (config.SAVE_RESULTS) {
            /* make sure there is a log file */
            if (is_child) {
                config.LOG_FILE = path.join(dirnames.results_dir, `log_${config.SIMULATION_RUN_ID}.txt`);
            } else {
                config.LOG_FILE = path.join(dirnames.results_dir, "log.txt");
            }
            console.log("log file=" + config.LOG_FILE);
        }
    } else {
        /* log file specified; write it even if SAVE_RESULT is false */
        if (!path.isAbsolute(config.LOG_FILE)) {
            /* expand the path of the log file relative to the config file */
            config.LOG_FILE = path.join(path.dirname(config.CONFIG_FILE), config.LOG_FILE);
        }
    }

    /* clean the log file */
    if (config.LOG_FILE != null) {
        try {
            console.log("removing log file=" + config.LOG_FILE);
            fs.unlinkSync(config.LOG_FILE);
        } catch (err) {
            /* Ignore "No such file errors" */
            if (err.code !== 'ENOENT') {
                throw err;
            }
        }
    }

    if (is_child) {
        log.log(log.INFO, null, "Main", `run child ${config.SIMULATION_RUN_ID}`);
        /* simply run the simulator once and exit */
        simulator.run_single();
        return;
    }

    if (config.WEB_ENABLED) {
        /* skip the normal processing in this case, instead, start the simulator in an infinite loop */
        simulator.run_interactive();
        /* start the web interface backed so it can issue commands to the looping simulator */
        web.start();
        return;
    }

    if (config.SAVE_RESULTS) {
        const dst_config_file = path.join(dirnames.results_dir, path.basename(config.CONFIG_FILE));
        if (config.CONFIG_FILE !== dst_config_file) {
            /* copy the configuration file to the output directory */
            log.log(log.INFO, null, "Main", `copying configuration file ${config.CONFIG_FILE} to output directory ${dst_config_file}[MAIN]`);
            fs.copyFileSync(config.CONFIG_FILE, dst_config_file);
        }
    }

    const is_done = new Array(config.SIMULATION_NUM_RUNS).fill(false);
    for (let i = 1; i < config.SIMULATION_NUM_RUNS; ++i) {
        /* if multiple runs specified, run N times and save the logs and stats in N separate files */
        const name = path.join(dirnames.self_dir, "main.mjs");
        const args = [config.CONFIG_FILE, i, dirnames.results_dir];
        log.log(log.INFO, null, "Main", `starting child process ${i}[MAIN]`);
        const child = fork(name, args);

        child.on('close', (code) => {
            log.log(log.INFO, null, "Main", `child process ${i} exited with code ${code}[MAIN]`);
            is_done[i] = true;
            /* when the parent and all child processes have completed their runs, finish */
            if (is_done.every((x) => x)) {
                finish();
            }
        });
    }

    /* there is always at least in run executed in the parent process */
    simulator.run_single();
    /* the parent process run is now completed, mark it as such */
    is_done[0] = true;
    /* when the parent and all child processes have completed their runs, finish */
    if (is_done.every((x) => x)) {
        finish();
    }
}

/* ------------------------------------- */

function finish()
{
    if (config.SAVE_RESULTS) {
        log.log(log.INFO, null, "Main", `simulation completed, results saved at ${dirnames.results_dir}[MAIN]`);
    } else {
        log.log(log.INFO, null, "Main", `simulation completed[MAIN]`);
    }

    if (config.SAVE_RESULTS) {
        /* merge all stats in a single file */
        const filenames = ["stats.json"];
        for (let i = 1; i < config.SIMULATION_NUM_RUNS; ++i) {
            filenames.push(`stats_${i}.json`);
        }
        const all_run_stats = {};
        for (let i = 0; i < config.SIMULATION_NUM_RUNS; ++i) {
            const stats = JSON.parse(fs.readFileSync(path.join(dirnames.results_dir, filenames[i])));
            all_run_stats[i] = stats["0"];
        }
        /* for consistency, always create this file, even if this is only a single run */
        fs.writeFileSync(path.join(dirnames.results_dir, "stats_merged.json"), JSON.stringify(all_run_stats, null, 2));
    }
}

/* ------------------------------------- */

/* Execute the simulator */
main();
