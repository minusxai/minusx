import axios from 'axios';
import { configs } from '../../constants';
import { toast } from '../toast';
const API_BASE_URL = configs.AUTH_BASE_URL

export default {
  async register() {
    try {
      const response = await axios.post(`${API_BASE_URL}/register`);
      return response.data;
    } catch (error) {
      toast({
        title: 'Error registering',
        description: "Please try again",
        status: 'error',
        duration: 5000,
        isClosable: true,
        position: 'bottom-right',
      })
      console.error('Error during registration:', error);
      throw error;
    }
  },

  async login(auth_jwt: string, otp: string, session_jwt: string ) {
    try {
      const response = await axios.post(`${API_BASE_URL}/login`, { auth_jwt, otp, session_jwt });
      return response.data;
    } catch (error) {
      toast({
        title: 'Invalid Code',
        description: "Please try again",
        status: 'error',
        duration: 5000,
        isClosable: true,
        position: 'bottom-right',
      })
      console.error('Error during login:', error);
      throw error;
    }
  },

  async verifyEmail(email: string) {
    try {
      const response = await axios.post(`${API_BASE_URL}/verify_email`, { email });
      return response.data;
    } catch (error) {
      toast({
        title: 'Error verifying email',
        description: "Please try again",
        status: 'error',
        duration: 5000,
        isClosable: true,
        position: 'bottom-right',
      })
      console.error('Error during verify email:', error);
      throw error;
    }
  },
}
