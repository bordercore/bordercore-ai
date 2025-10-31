"""
This module fetches current weather conditions and forecast data for a fixed
location (hard-coded ZIP/postal code `02138`) from WeatherAPI, then builds
a natural-language summary of that weather (temperature, conditions, humidity,
wind chill, forecast high/low, sun/moon info, and active alerts if any).
"""

import requests

import settings


def get_weather_info(command: str) -> str:
    """
    Build a weather-aware prompt for a language model.

    This function queries WeatherAPI for current conditions and a 1-day
    forecast for location ``02138``.
    It then assembles:
      - Current temperature (°F), condition text, humidity, and wind chill.
      - Forecast summary (condition text, high/low in °F).
      - Sunrise, sunset, and moon phase.
      - The first active weather alert, if any (event name, description,
        and expiry timestamp).

    It returns a single formatted string that:
      * Describes those conditions as a series of factual statements.
      * Embeds the caller's weather question (`command`).
      * Instructs a downstream LLM to answer ONLY using those statements,
        including surfacing alert info in a separate paragraph if one exists.

    Args:
        command: Natural-language weather question from the user. For example:
            "Do I need an umbrella today?" or
            "What's the forecast tonight?"

    Returns:
        A formatted prompt string intended to be fed to a language model.
        The prompt includes:
          - The user's question.
          - The generated weather description.
          - Explicit instructions on how the model should answer.
    """
    uri_api = f"http://api.weatherapi.com/v1/forecast.json?key={settings.weather_api_key}&q=02138&days=1&aqi=yes&alerts=yes"
    weather_info = requests.get(uri_api, timeout=20).json()

    weather_description = f"""
    The current temperature is {int(weather_info['current']['temp_f'])}.
    The current condition is {weather_info['current']['condition']['text']}.
    The current humidity is {weather_info['current']['humidity']}.
    The current wind chill is {int(weather_info['current']['windchill_f'])}.
    The weather forecast is {weather_info['forecast']['forecastday'][0]['day']['condition']['text']} with a high of {int(weather_info['forecast']['forecastday'][0]['day']['maxtemp_f'])} and a low of {int(weather_info['forecast']['forecastday'][0]['day']['mintemp_f'])}.
    The sunrise is {weather_info['forecast']['forecastday'][0]['astro']['sunrise']}.
    The sunset is {weather_info['forecast']['forecastday'][0]['astro']['sunset']}.
    The moon phase is {weather_info['forecast']['forecastday'][0]['astro']['moon_phase']}.
    """

    if len(weather_info["alerts"]["alert"]) > 0:
        weather_description += f"""
        There is a weather alert: {weather_info['alerts']['alert'][0]['event']}. The description for this alert is {weather_info['alerts']['alert'][0]['desc']}. It expires on {weather_info['alerts']['alert'][0]['expires']}
        """

    return f"""
    I will give you a series of statements that describes either the current weather, or the weather forecast. I want you to answer a weather question based on those statements and nothing else. In particular, if the question is a general query about the weather, give me a concise summary of the weather. If there is a weather alert, tell me what kind of weather alert it is, its description, and when it expires, in a date and time with the format like January 1, 2023 at 3pm. Put the weather alert information in a separate paragraph. If there is no weather alert information present then don't mentio weather alerts. The weather question is the following: {command}. Answer that question based on the following series of statements about the weather: {weather_description}.
    """
