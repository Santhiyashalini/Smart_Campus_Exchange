// requestService.js
import axios from "axios";

const BASE_URL = "http://localhost:8081/api/requests";

const getAuthHeaders = () => {
  const token = localStorage.getItem("token");

  return {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
};


// ==========================================
// CREATE REQUEST
// ==========================================

export const createRequest = async (requestData) => {

  const response = await axios.post(
    BASE_URL,
    requestData,
    getAuthHeaders()
  );

  return response.data;
};


// ==========================================
// GET MY REQUESTS
// ==========================================

export const getMyRequests = async () => {

  const response = await axios.get(
    `${BASE_URL}/my`,
    getAuthHeaders()
  );

  return response.data;
};


// ==========================================
// GET INCOMING REQUESTS
// (requests other students sent you as a seller)
// Confirmed: GET /api/requests/incoming
// ==========================================

export const getIncomingRequests = async () => {

  const response = await axios.get(
    `${BASE_URL}/incoming`,
    getAuthHeaders()
  );

  return response.data;
};


// ==========================================
// GET REQUEST BY ID
// Confirmed: GET /api/requests/{id}
// Used by NotificationsSection.jsx to fetch pickup details for a
// REQUEST_ACCEPTED notification.
// ==========================================

export const getRequestById = async (requestId) => {

  const response = await axios.get(
    `${BASE_URL}/${requestId}`,
    getAuthHeaders()
  );

  return response.data;
};


// ==========================================
// ACCEPT REQUEST
// ==========================================

export const acceptRequest = async (requestId, pickupDetails) => {

  const response = await axios.put(
    `${BASE_URL}/${requestId}/accept`,
    pickupDetails,
    getAuthHeaders()
  );

  return response.data;
};


// ==========================================
// REJECT REQUEST
// ==========================================

export const rejectRequest = async (requestId) => {

  const response = await axios.put(
    `${BASE_URL}/${requestId}/reject`,
    {},
    getAuthHeaders()
  );

  return response.data;
};


// ==========================================
// CANCEL REQUEST
//
// NOTE: RequestController.java has no PUT /{id}/cancel endpoint —
// only /accept and /reject exist. This will 404 if called as-is.
// ==========================================

export const cancelRequest = async (requestId) => {

  const response = await axios.put(
    `${BASE_URL}/${requestId}/cancel`,
    {},
    getAuthHeaders()
  );

  return response.data;
};


// ==========================================
// DELETE REQUEST
// Confirmed: DELETE /api/requests/{id}
// Returns 204 No Content — response.data will be undefined, which is
// expected here, not a bug.
// ==========================================

export const deleteRequest = async (requestId) => {

  const response = await axios.delete(
    `${BASE_URL}/${requestId}`,
    getAuthHeaders()
  );

  return response.data;
};