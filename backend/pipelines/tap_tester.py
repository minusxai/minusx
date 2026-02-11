"""
Test tap configurations without running full pipeline.
"""
import requests
from typing import Dict, Any


def test_tap_facebook(config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Test tap-facebook credentials by making a simple API call.

    Args:
        config: Tap configuration with access_token and account_id

    Returns:
        {
            "success": bool,
            "message": str,
            "details": dict (optional)
        }
    """
    access_token = config.get('access_token')
    account_id = config.get('account_id')

    if not access_token or not account_id:
        return {
            "success": False,
            "message": "Missing access_token or account_id"
        }

    # Normalize account_id: ensure it has 'act_' prefix for API call
    # (The tap itself adds 'act_' automatically, but the Graph API test needs it)
    if not account_id.startswith('act_'):
        account_id = f"act_{account_id}"

    try:
        # Make a simple API call to verify credentials
        # Fetch account info from Facebook Marketing API
        url = f"https://graph.facebook.com/v18.0/{account_id}"
        params = {
            'access_token': access_token,
            'fields': 'id,name,account_status'
        }

        response = requests.get(url, params=params, timeout=10)

        if response.status_code == 200:
            data = response.json()
            return {
                "success": True,
                "message": f"Successfully connected to account: {data.get('name', account_id)}",
                "details": {
                    "account_id": data.get('id'),
                    "account_name": data.get('name'),
                    "account_status": data.get('account_status')
                }
            }
        elif response.status_code == 400:
            error_data = response.json()
            error_msg = error_data.get('error', {}).get('message', 'Invalid request')
            return {
                "success": False,
                "message": f"Invalid credentials or account ID: {error_msg}"
            }
        elif response.status_code == 401:
            return {
                "success": False,
                "message": "Invalid access token. Please check your Facebook API credentials."
            }
        elif response.status_code == 403:
            return {
                "success": False,
                "message": "Access denied. Your token may not have permission to access this account."
            }
        else:
            return {
                "success": False,
                "message": f"Facebook API error: {response.status_code} - {response.text}"
            }

    except requests.exceptions.Timeout:
        return {
            "success": False,
            "message": "Request timed out. Please check your internet connection."
        }
    except requests.exceptions.RequestException as e:
        return {
            "success": False,
            "message": f"Network error: {str(e)}"
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"Unexpected error: {str(e)}"
        }


def test_tap(tap_name: str, config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Test a tap configuration.

    Args:
        tap_name: Name of the tap (e.g., 'tap-facebook')
        config: Tap configuration

    Returns:
        Test result dict with success, message, and optional details
    """
    if tap_name == 'tap-facebook':
        return test_tap_facebook(config)
    else:
        return {
            "success": False,
            "message": f"Testing not supported for {tap_name}"
        }
