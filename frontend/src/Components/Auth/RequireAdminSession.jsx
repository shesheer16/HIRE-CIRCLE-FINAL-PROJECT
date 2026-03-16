import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { hasAdminSession } from '../../utils/adminSession';

const RequireAdminSession = ({ children }) => {
  const location = useLocation();

  if (!hasAdminSession()) {
    return <Navigate to="/admin/login" replace state={{ from: location }} />;
  }

  return children || <Outlet />;
};

export default RequireAdminSession;
