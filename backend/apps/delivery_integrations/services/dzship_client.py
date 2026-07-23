import requests
import logging

logger = logging.getLogger(__name__)

class DzshipClient:
    BASE_URL = "https://freeship.dzbuild.com/v1"

    @classmethod
    def create_order(cls, courier, credentials, order_data):
        """
        Calls the dzship unified API to create a delivery order.
        
        :param courier: 'yalidine', 'zr_express', 'maystro', etc.
        :param credentials: dict with 'apiId' and 'apiToken' (or whatever specific keys dzship expects for that courier)
        :param order_data: dict with recipient details and product list.
        :return: dict with trackingNumber and status
        """
        url = f"{cls.BASE_URL}/orders"
        
        payload = {
            "courier": courier,
            "credentials": credentials,
            "order": order_data
        }
        
        try:
            # We don't have the full schema for credentials for all couriers,
            # but standardizing on apiId / apiToken based on the docs.
            response = requests.post(url, json=payload, headers={"Content-Type": "application/json"})
            response.raise_for_status()
            data = response.json()
            return data
        except requests.RequestException as e:
            logger.error(f"DzshipClient create_order failed: {e}")
            if e.response is not None:
                logger.error(f"Response: {e.response.text}")
            raise Exception("Failed to create order via delivery agency.")
