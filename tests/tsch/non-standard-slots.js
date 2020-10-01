
/* 
 * The idea of this is to emulate slotframs of 7 slots compressed in a 3 slots.
 * Normally, the duration of a slot is 10 ms (0.01 seconds), and the slotframe: 70 ms (0.07 seconds).
 * Here, the slotframe has 3 slots, the last one of which is 5 times longer (50 ms).
 * The slotframe is still kept to 70 ms in total. Assuming that the last 4 slots were idle,
 * the operation of the protocol is not affected (other than the channel hopping being different).
 * The length 3 was selected to keep the slotframe size to a non-even prime number.
 */
state.log.log(state.log.INFO, null, "User", `Initializing non-standard slot size`);
state.timeline.slot_timings = [0.01, 0.01, 0.05];
