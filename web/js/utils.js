/* utility functions */
TSCH_SIM.utils = function() {
    function format_time(seconds, num_digits=3) {
        let timestring = "";
        try {
            let f = parseFloat(seconds);
            if (f >= 3600) {
                const hours = Math.trunc(f / 3600);
                f -= hours * 3600;
                timestring += hours + ":";
            }
            const max_error = Math.pow(10, -num_digits);
            if (timestring || f >= 60 - max_error) {
                const mins = Math.trunc((f + max_error) / 60);
                f -= mins * 60;
                if (timestring !== "" && mins < 10) {
                    timestring += "0";
                }
                timestring += mins + ":";
            }
            if (timestring !== "" && f < 10) {
                timestring += "0";
            }
            if (f < 0.0) {
                f = 0.0;
            }
            timestring += f.toFixed(num_digits);
        } catch(err) {
            console.log("error: " + err);
        }
        return timestring;
    }

    return {
        format_time: format_time,
    };

}();
