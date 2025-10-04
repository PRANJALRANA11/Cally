import { bookAppointment, rescheduleAppointment, cancelAppointment, } from "../src/booking.js";
import { textYield } from "../src/controller.js";
async function run() {
    //   await rescheduleAppointment(
    //     "pranajlrana1235@gmail.com",
    //     "2025-10-02",
    //     "21:00"
    //   );
    //   await cancelAppointment("pranajlrana1235@gmail.com");
    //   await bookAppointment(
    //     "pranjal",
    //     "2025-10-02",
    //     "20:00",
    //     "pranajlrana1235@gmail.com"
    //   );
    await textYield("hy i wanted to schedule an appointment at ten am wednesday myself pranjal and my email is pranajlrana1235@gmail.com");
}
run();
