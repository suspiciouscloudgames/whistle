// -------
// whistle player tag : ranges in json, tx over udp
// -------

#include <Arduino.h>

// arduino json
#include <ArduinoJson.h>

//// --------------------------
//// udp over serial (tx only)

#include <WiFi.h>
#include <WiFiUdp.h>

// wifi credentials

// home network
// const char* ssid = "nosignal 2G";
// const char* password = "1111100000";
// IPAddress remoteIP(192, 168, 88, 30); // Destination PC or device IP

// atelier network
const char* ssid = "teapot";
const char* password = "3333388888";
IPAddress remoteIP(192, 168, 88, 110); // Destination PC or device IP

// port is same
const uint16_t remotePort = 5195;
const uint16_t localPort = 8888; // a dummy

// udp
WiFiUDP Udp;
uint8_t buffer[256];


//// --------------------------
//// uwb config

#define UWB_INDEX 0
#define PAN_INDEX 0
#define TAG
#define UWB_TAG_COUNT 1

//// --------------------------
//// peripherals
#include <Wire.h>
// screen
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
// serial for monitoring
#define SERIAL_LOG Serial
// serial for mauwb
#define SERIAL_AT mySerial2
HardwareSerial SERIAL_AT(2);
// pins
#define RESET 16
//
#define IO_RXD2 18
#define IO_TXD2 17
//
#define I2C_SDA 39
#define I2C_SCL 38
// screen
Adafruit_SSD1306 display(128, 64, &Wire, -1);



//// --------------------------
////
void setup()
{
    // wifi, udp
    WiFi.begin(ssid, password);
    while (WiFi.status() != WL_CONNECTED) {
        delay(250);
    }
    Udp.begin(localPort);

    // pins
    pinMode(RESET, OUTPUT);
    digitalWrite(RESET, HIGH);

    // SERIAL_LOG.begin(250000); // this didn't work for me.
    SERIAL_LOG.begin(115200);

    SERIAL_LOG.print(F("Hello! ESP32-S3 AT command V1.0 Test"));
    SERIAL_AT.begin(115200, SERIAL_8N1, IO_RXD2, IO_TXD2);

    SERIAL_AT.println("AT");
    Wire.begin(I2C_SDA, I2C_SCL);
    delay(1000);
    // SSD1306_SWITCHCAPVCC = generate display voltage from 3.3V internally
    if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C))
    { // Address 0x3C for 128x32
        SERIAL_LOG.println(F("SSD1306 allocation failed"));
        for (;;)
            ; // Don't proceed, loop forever
    }
    display.clearDisplay();

    logoshow();

    sendData("AT?", 2000, 1);
    sendData("AT+RESTORE", 5000, 1);

    sendData(config_cmd(), 2000, 1);
    sendData(cap_cmd(), 2000, 1);

    sendData("AT+SETRPT=1", 2000, 1);
    sendData(Pan_cmd(), 2000, 1);
    sendData("AT+SAVE", 2000, 1);
    sendData("AT+RESTART", 2000, 1);
//    sendData("AT+SLEEP=65535", 2000, 1);
//    esp_deep_sleep_start();
}

long int runtime = 0;
String response = "";
String rec_head = "AT+RANGE";

void loop()
{
    // unused, send AT CMDs to MaUWB
    while (SERIAL_LOG.available() > 0)
    {
        SERIAL_AT.write(SERIAL_LOG.read());
        yield();
    }

    // receive reports & re-package into a json & tx over udp
    while (SERIAL_AT.available() > 0)
    {
        char c = SERIAL_AT.read();

        if (c == '\r')
            continue;

        if (c == '\n')
        {
            //
            // SERIAL_LOG.println(response);

            // filter only AT+RANGE msgs.
            if (response.indexOf(rec_head) != -1) {

                // split
                String id_str = response.substring(response.indexOf("tid:") + 4, response.indexOf(",mask:"));
                String seq_str = response.substring(response.indexOf("seq:") + 4, response.indexOf(",range:"));
                String range_str = response.substring(response.indexOf("range:"), response.indexOf(",rssi:"));
                // String rssi_str = response.substring(response.indexOf("rssi:"));

                int range_list[8];
                // double rssi_list[8];

                //
                int count = 0;
                count = sscanf(range_str.c_str(), "range:(%d,%d,%d,%d,%d,%d,%d,%d)",
                               &range_list[0], &range_list[1], &range_list[2], &range_list[3],
                               &range_list[4], &range_list[5], &range_list[6], &range_list[7]);

                if (count != 8)
                {
                    Serial.println("RANGE ANALY ERROR");
                    Serial.println(count);
                    continue;
                }

                // count = sscanf(rssi_str.c_str(), "rssi:(%lf,%lf,%lf,%lf,%lf,%lf,%lf,%lf)",
                //                &rssi_list[0], &rssi_list[1], &rssi_list[2], &rssi_list[3],
                //                &rssi_list[4], &rssi_list[5], &rssi_list[6], &rssi_list[7]);

                // if (count != 8)
                // {
                //     Serial.println("RSSI ANALY ERROR");
                //     Serial.println(count);
                //     continue;
                // }

                // re-package json doc

                // target format

                // {
                //   "type": "ranges",
                //   "tagId": "0",
                //   "seq": 42,
                //   "ranges": [
                //     { "anchorId": "0", "distance": 3.419064199455752 },
                //     { "anchorId": "1", "distance": 5.974110812497538 },
                //     { "anchorId": "2", "distance": 5.974110812497538 },
                //     { "anchorId": "3", "distance": 3.2388269481403297 }
                //   ]
                // }

                JsonDocument doc;
                //
                doc["type"] = "ranges";
                doc["tagId"] = id_str;
                doc["seq"] = seq_str.toInt();
                //
                JsonArray ranges = doc["ranges"].to<JsonArray>();
                for (int jj = 0; jj < 4; jj++) {
                    JsonObject obj = ranges.add<JsonObject>();
                    obj["anchorId"] = String(jj);
                    obj["distance"] = range_list[jj] / 100.0;
                }
                // doc.shrinkToFit();  // optional

                String json;
                serializeJson(doc, json);

                Serial.println(json);

                // tx over udp
                Udp.beginPacket(remoteIP, remotePort);
                Udp.write((uint8_t*)json.c_str(), json.length());
                Udp.endPacket();

                //
            } else {
                //
                Serial.println(response);
                //
            }
            response = "";
        }
        else
            response += c;
    }
}

// SSD1306

void logoshow(void)
{
    display.clearDisplay();

    display.setTextSize(1);              // Normal 1:1 pixel scale
    display.setTextColor(SSD1306_WHITE); // Draw white text
    display.setCursor(0, 0);             // Start at top-left corner
    display.println(F("MaUWB DW3000"));

    display.setCursor(0, 20); // Start at top-left corner
    // display.println(F("with STM32 AT Command"));

    display.setTextSize(2);

    String temp = "";

    temp = temp + "T" + UWB_INDEX;

    temp = temp + "   6.8M";

    display.println(temp);

    display.setCursor(0, 40);

    temp = "Total: ";
    temp = temp + UWB_TAG_COUNT;
    display.println(temp);

    display.display();

    delay(2000);
}

String sendData(String command, const int timeout, boolean debug)
{
    String response = "";
    // command = command + "\r\n";

    SERIAL_LOG.println(command);
    SERIAL_AT.println(command); // send the read character to the SERIAL_LOG

    long int time = millis();

    while ((time + timeout) > millis())
    {
        while (SERIAL_AT.available())
        {

            // The esp has data so display its output to the serial window
            char c = SERIAL_AT.read(); // read the next character.
            response += c;
        }
    }

    if (debug)
    {
        SERIAL_LOG.println(response);
    }

    return response;
}

String config_cmd()
{
    String temp = "AT+SETCFG=";

    // Set device id
    temp = temp + UWB_INDEX;

    // Set device role
    //x2:Device Role(0:Tag / 1:Anchor)
    temp = temp + ",0";


    // Set frequence 850k or 6.8M(0:850K/1:6.8M

    temp = temp + ",1";

    // Set range filter  (multi-location fuction must close range filter)
    temp = temp + ",0";

    return temp;
}

String cap_cmd()
{
    String temp = "AT+SETCAP=";

    // Set Tag capacity
    temp = temp + UWB_TAG_COUNT;

    //  Time of a single time slot  6.5M : 10MS  850K ： 15MS
    temp = temp + ",10";

    //X3:extMode, whether to increase the passthrough command when transmitting
    //(0: normal packet when communicating, 1: extended packet when communicating)
    temp = temp + ",1";

    return temp;
}

String Pan_cmd()
{
    String temp = "AT+SETPAN=";

    temp = temp + PAN_INDEX;

    return temp;
}
