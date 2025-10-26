import dayjsLib from "dayjs";
import "dayjs/locale/es";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

dayjsLib.extend(utc);
dayjsLib.extend(timezone);
dayjsLib.locale("es");

export const dayjs = dayjsLib;
