import axios from "axios";

// EventBus for React (using tiny-emitter)
import emitter from "tiny-emitter/instance";

export const EventBus = {
  $on: (...args: any[]) => emitter.on(...args),
  $once: (...args: any[]) => emitter.once(...args),
  $off: (...args: any[]) => emitter.off(...args),
  $emit: (...args: any[]) => emitter.emit(...args),
};

/**
 * Use axios to perform an HTTP GET call.
 */
export function doGet(
  url: string,
  callback: (response: any) => void,
  errorMsg = "",
  responseType: "json" | "text" | "arraybuffer" = "json"
) {
  axios
    .get(url, { responseType: responseType })
    .then((response) => {
      if (response.data.status && response.data.status !== "OK") {
        EventBus.$emit("toast", {
          title: "Error!",
          body: errorMsg,
          variant: "danger",
          autoHide: false,
        });
        console.log(errorMsg);
      } else {
        return callback(response);
      }
    })
    .catch((error) => {
      EventBus.$emit("toast", {
        title: "Error!",
        body: `${errorMsg}: ${error.message}`,
        variant: "danger",
        autoHide: false,
      });
      console.error(error);
    });
}

/**
 * Use axios to perform an HTTP POST call.
 */
export function doPost(
  url: string,
  params: Record<string, any>,
  callback: (response: any) => void,
  successMsg = "",
  errorCallback: () => void = () => {}
): void {
  const bodyFormData = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    bodyFormData.append(key, value as string);
  }

  axios(url, {
    method: "POST",
    data: bodyFormData,
  })
    .then((response) => {
      if (response.data.status && response.data.status !== "OK") {
        EventBus.$emit("toast", {
          title: "Error",
          body: response.data.message,
          variant: response.data.status === "Warning" ? "warning" : "danger",
          autoHide: false,
        });
        errorCallback();
        console.log("Error: ", response.data.message);
      } else {
        const body = response.data.message ? response.data.message : successMsg;
        if (body) {
          EventBus.$emit("toast", {
            title: "Success",
            body: response.data.message ? response.data.message : successMsg,
            variant: "info",
          });
        }
        callback(response);
      }
    })
    .catch((error) => {
      EventBus.$emit("toast", {
        title: "Error",
        body: error.message,
        variant: "danger",
        autoHide: false,
      });
      errorCallback();
      console.error(error);
    });
}
