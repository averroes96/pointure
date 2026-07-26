"""
AI-powered message parser using Google Gemini.

Takes raw customer messages from social channels (Messenger, Instagram, WhatsApp)
and extracts structured order data (name, phone, wilaya, commune, address, notes).
"""
import json
import logging

from decouple import config

logger = logging.getLogger(__name__)

# Lazy-init: SDK is only loaded when first message arrives
_model = None

EXTRACTION_PROMPT = """You are an order extraction assistant for an Algerian shoe store.
Extract the customer's details from the message below and return ONLY a valid JSON object.

Required JSON keys:
- "customer_name": The customer's full name (string, empty if unknown)
- "phone": Phone number (string, empty if unknown)
- "wilaya": The Algerian wilaya code as a 2-digit string from "01" to "58" (e.g. "16" for Algiers). Leave empty if unknown.
- "commune": Commune name (string, empty if unknown)
- "address": Street address or delivery details (string, empty if unknown)
- "notes": What the customer ordered — product names, sizes, colours, any special requests (string)
- "is_order_intent": Boolean (true/false). Set to true ONLY if the customer is expressing a clear intent to buy/order something (e.g., providing an address, phone number, or explicitly saying "I want to buy"). Set to false if it's just casual chat, a simple question, or greeting (e.g. "Salam", "Chhal?", "Are you open?").

Rules:
- Return ONLY raw JSON. No markdown, no code blocks, no extra text.
- If you cannot determine a field, leave it as an empty string "".
- The wilaya MUST be the numeric code (01-58), NOT the name. Convert names to codes (e.g. "Alger" → "16", "Oran" → "31", "Constantine" → "25").
- Phone numbers should keep the leading 0 (e.g. "0555123456").

Customer message:
{message}"""


def _get_model():
    """Lazy-initialize the Gemini model."""
    global _model
    if _model is None:
        api_key = config("GEMINI_API_KEY", default="")
        if not api_key:
            raise ValueError(
                "GEMINI_API_KEY is not set. Add it to your .env file to enable AI parsing."
            )
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        _model = genai.GenerativeModel("gemini-3.6-flash")
    return _model


def parse_order_message(message_text: str) -> dict:
    """
    Send a raw customer message to Gemini and return a structured dict.

    Returns a dict with keys: customer_name, phone, wilaya, commune, address, notes.
    Returns None if parsing fails completely.
    """
    if not message_text or not message_text.strip():
        return None

    try:
        model = _get_model()
        prompt = EXTRACTION_PROMPT.format(message=message_text)
        response = model.generate_content(prompt)

        raw_text = response.text.strip()

        # Strip markdown code fences if the model returns them despite instructions
        if raw_text.startswith("```"):
            raw_text = raw_text.split("\n", 1)[1] if "\n" in raw_text else raw_text[3:]
            if raw_text.endswith("```"):
                raw_text = raw_text[:-3].strip()

        parsed = json.loads(raw_text)

        # Normalize and validate
        result = {
            "customer_name": str(parsed.get("customer_name", "")).strip(),
            "phone": str(parsed.get("phone", "")).strip(),
            "wilaya": str(parsed.get("wilaya", "")).strip(),
            "commune": str(parsed.get("commune", "")).strip(),
            "address": str(parsed.get("address", "")).strip(),
            "notes": str(parsed.get("notes", "")).strip(),
            "is_order_intent": bool(parsed.get("is_order_intent", True)),
        }

        logger.info("AI parsed order: name=%s, wilaya=%s", result["customer_name"], result["wilaya"])
        return result

    except json.JSONDecodeError as e:
        logger.warning("AI returned non-JSON response: %s", e)
        return None
    except Exception as e:
        logger.exception("AI parsing failed: %s", e)
        return None
