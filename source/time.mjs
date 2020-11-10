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
 *         Time keeping class together with a timer library
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import * as utils from './utils.mjs';
import * as log from './log.mjs';
import { heap_insert, heap_extract_min, heap_remove_at } from './heap.mjs';

const timers = [];
export let timeline;

/* ------------------------------------- */

export class Timer
{
    constructor(interval, is_periodic, argument, callback) {
        this.fire_at = timeline.seconds + interval;
        this.interval = interval;
        this.is_periodic = is_periodic;
        this.argument = argument;
        this.callback = callback;
        this.heap_position = -1;
    }
}

/* ------------------------------------- */

/* Network-wide timeline */
class Timeline {
    constructor() {
        /* the time in TSCH networks is kept in both ASN and seconds */
        this.asn = 0;
        this.seconds = 0;
        /* default timings: 10 ms for all slots */
        this.slot_timings = [0.01];
    }

    get_next_seconds() {
        /* calculate the amount of seconds in this timeslot */
        const timeslot = this.asn % this.slot_timings.length;
        return this.seconds + this.slot_timings[timeslot];
    }

    step() {
        /* advance the seconds counter by the amount of seconds in this timeslot */
        this.seconds = this.get_next_seconds();
        /* increment the timeslot number */
        this.asn += 1;

        /* fire timers that need to be fired */
        const periodic_timers = [];
        let t;
        while (timers.length && timers[0].fire_at <= this.seconds) {
            /* get first timer and remove it from the array */
            t = heap_extract_min(timers, timer_less_than);
            /* this may add the timer back to the timers array */
            t.callback(t.argument, this.seconds);
            /* periodic timers (assumed to not add the timer in callback) */
            if (t.is_periodic) {
                periodic_timers.push(t);
            }
        }

        /* add back all periodic timers */
        const seconds = this.seconds;
        periodic_timers.forEach(function (t) {
            const new_t = add_timer(t.fire_at - seconds + t.interval, true, t.argument, t.callback);
            new_t.interval = t.interval;
        });
    }
}

/* ------------------------------------- */

export function reset_time()
{
    timeline = new Timeline();
    log.initialize(timeline);
    /* clear all timers */
    timers.length = 0;
}

/* ------------------------------------- */

function timer_less_than(a, b)
{
    return a.fire_at < b.fire_at;
}

/* ------------------------------------- */

export function add_timer(interval, is_periodic, argument, callback)
{
    utils.assert(!isNaN(interval), `interval should be a number, not ${interval}`);
    const t = new Timer(interval, is_periodic, argument, callback);
    /* log.log(log.INFO, null, "Main", `add timer, interval=${interval} fire_at=${t.fire_at}`); */
    heap_insert(timers, t, timer_less_than);
    return t;
}

/* ------------------------------------- */

export function remove_timer(timer)
{
    /* linear search, in case `heap_position` is not stored: */
    /* for (let i = 0; i < timers.length; ++i) {
        if (timers[i] === timer) {
            heap_remove_at(timers, i, timer_less_than);
            break;
        }
    } */
    utils.assert(timer.heap_position !== -1, "attempting to remove timer not in the heap");
    heap_remove_at(timers, timer.heap_position, timer_less_than);
}

/* ------------------------------------- */

/* On loading, run the reset function */
reset_time();
