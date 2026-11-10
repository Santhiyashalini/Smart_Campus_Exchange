import { Routes, Route } from "react-router-dom";

import Landing from "./pages/Landing/Landing";
import Auth from "./pages/Auth/Auth";
import ProtectedRoute from "./components/ProtectedRoute/ProtectedRoute";
import Profile from "./pages/Profile/Profile";
import StudentDashboard from "./pages/student/StudentDashboard";
import AdminDashboard from "./pages/Admin/AdminDashboard";

function App() {
  return (
    <Routes>

      <Route path="/" element={<Landing />} />

      <Route path="/auth" element={<Auth />} />

      // App.jsx
<Route
  path="/AdminDashboard"
  element={
    <ProtectedRoute requiredRole="ADMIN">
      <AdminDashboard />
    </ProtectedRoute>
  }
/>

<Route
  path="/StudentDashboard"
  element={
    <ProtectedRoute requiredRole="STUDENT">
      <StudentDashboard />
    </ProtectedRoute>
  }
/>

      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <Profile />
          </ProtectedRoute>
        }
      />

    </Routes>
  );
}

export default App;