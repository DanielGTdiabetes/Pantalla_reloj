
import sys
import os
from datetime import datetime
import logging

# Add backend to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.data_sources_ics import fetch_ics_calendar_events

ICS_CONTENT = """BEGIN:VCALENDAR
PRODID:-//Google Inc//Google Calendar 70.9054//EN
VERSION:2.0
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:Calendario
X-WR-TIMEZONE:Europe/Madrid
BEGIN:VTIMEZONE
TZID:Europe/Madrid
X-LIC-LOCATION:Europe/Madrid
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:GMT+2
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:GMT+1
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
DTSTART;VALUE=DATE:20131209
DTEND;VALUE=DATE:20131210
DTSTAMP:20251031T064212Z
UID:9kucrbaoaklh1r63007ctidt2o@google.com
CREATED:20131213T121931Z
LAST-MODIFIED:20131213T121932Z
SEQUENCE:0
STATUS:CONFIRMED
SUMMARY:VACA MANOLO BARRI
TRANSP:TRANSPARENT
CATEGORIES:http://schemas.google.com/g/2005#event
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=Europe/Madrid:20150401T080000
DTEND;TZID=Europe/Madrid:20150401T090000
RRULE:FREQ=DAILY;UNTIL=20150401T130000Z
DTSTAMP:20251031T064212Z
UID:5ce1fff8-7daa-48bb-b1e1-cc0e9361e998
CLASS:PUBLIC
CREATED:20150323T115826Z
LAST-MODIFIED:20200120T071109Z
LOCATION:CASTELLON
SEQUENCE:0
STATUS:CONFIRMED
SUMMARY:ITV FIAT CASTELLON
TRANSP:OPAQUE
X-MOZ-LASTACK:99991231T235859Z
X-LIC-ERROR;X-LIC-ERRORTYPE=VALUE-PARSE-ERROR:No value for DESCRIPTION prop
 erty. Removing entire property:
X-MOZ-GENERATION:2
X-MICROSOFT-CDO-BUSYSTATUS:BUSY
END:VEVENT
END:VCALENDAR"""

def test_ics_parsing():
    # Write to temp file
    temp_file = "backend/temp_test.ics"
    with open(temp_file, "w", encoding="utf-8") as f:
        f.write(ICS_CONTENT)

    with open("backend/test_output.txt", "w", encoding="utf-8") as out:
        try:
            out.write(f"Parsing {temp_file}...\n")
            events = fetch_ics_calendar_events(path=temp_file)
            out.write(f"Found {len(events)} events.\n")
            
            for event in events:
                out.write(f"Event: {event['title']}\n")
                out.write(f"  Start: {event['start']}\n")
                out.write(f"  End:   {event['end']}\n")
                out.write(f"  Loc:   {event['location']}\n")
                out.write("-" * 20 + "\n")

        except Exception as e:
            out.write(f"Error: {e}\n")
            import traceback
            traceback.print_exc(file=out)
        finally:
            if os.path.exists(temp_file):
                os.remove(temp_file)

if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG)
    test_ics_parsing()
