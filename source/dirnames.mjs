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
 *         Wrapper for detecting the local directory name.
 *         This is needed to allow relative paths to be used in the source code
 *         and in the configuration files.
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import path from 'path';
import config from "./config.mjs";

/* the directory of the current script */
import expose from './expose.js';
const {__dirname} = expose;

/* For Node 10+ versions, the directory of the current script is as simple as: */
/* const __dirname = path.dirname(fileURLToPath(import.meta.url)); */

/* decide the directory for the result files */
let results_dir = config.RESULTS_DIR;
if (!results_dir) {
    const tzoffset = new Date(Date.now()).getTimezoneOffset() * 60000;
    const datetime = new Date(Date.now() - tzoffset).toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/, '-').replace(/:/, '-');
    results_dir = path.join(__dirname, "..", "results", datetime);
} else {
    if (!path.isAbsolute(results_dir)) {
        /* set it relative to the configuration file */
        results_dir = path.join(path.dirname(config.CONFIG_FILE), results_dir);
    }
}

const dirnames = {results_dir: results_dir, self_dir: __dirname};
export default dirnames;
