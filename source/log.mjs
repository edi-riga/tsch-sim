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
 *         Logging module
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import config from "./config.mjs";
import status from "./status.mjs";
import fs from 'fs';

/* Supported log levels */
export const ERROR = 1;
export const WARNING = 2;
export const INFO = 3;
export const DEBUG = 4;

/* Filled by the time module to avoid circular dependencies in imports */
let timeline = null;

/* Log a message */
export function log(severity, node, topic, msg)
{
    let log_level;
    if (config.LOG_LEVELS && config.LOG_LEVELS.hasOwnProperty(topic)) {
        log_level = config.LOG_LEVELS[topic];
    } else if (config.LOG_LEVELS_DEFAULT.hasOwnProperty(topic)) {
        log_level = config.LOG_LEVELS_DEFAULT[topic];
    } else {
        log_level = config.LOG_LEVEL_DEFAULT_NOTOPIC;
    }

    let node_s;
    if (node) {
        /* Use the node string ID */
        node_s = node.sid;
    } else {
        /* Use -1 for log entries without an associated node */
        node_s = "-1  ";
    }

    if (severity <= log_level) {
        if (severity <= ERROR) {
            msg = "error: " + msg;
        } else if (severity === WARNING) {
            msg = "warning: " + msg;
        }

        if (config.WEB_ENABLED) {
            if (status.log.length >= config.WEB_MAX_LOGS) {
                status.log.shift();
            }
            status.log.push({node: node_s, time: timeline.seconds, topic: topic, msg: msg});
        }

        /* Add ASN and node id to the message */
        let sasn = `${timeline.asn}`;
        if (timeline.asn < 10000) {
            sasn += ' ';
            if (timeline.asn < 1000) {
                sasn += ' ';
                if (timeline.asn < 100) {
                    sasn += ' ';
                    if (timeline.asn < 10) {
                        sasn += ' ';
                    }
                }
            }
        }

        msg = `asn=${sasn}\tid=${node_s}\t${topic}\t${msg}`;
        if (severity <= WARNING) {
            console.log("\x1b[31m" + msg + "\x1b[0m");
        } else {
            console.log(msg);
        }
        if (config.SAVE_RESULTS || config.LOG_FILE) {
            fs.appendFileSync(config.LOG_FILE, msg + "\n");
        }
    }
}

/* ------------------------------------- */

export function initialize(tl)
{
    timeline = tl;
}
