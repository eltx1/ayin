"use client";

import { useCallback, useState } from "react";
import { AccountMfa } from "./account-mfa";
import { AccountSecuritySessions } from "./account-security-sessions";

export function AccountSecurityWorkspace() {
  const [revision, setRevision] = useState(0);
  const refreshSessions = useCallback(() => setRevision((value) => value + 1), []);
  return (
    <>
      <AccountSecuritySessions key={revision} />
      <AccountMfa onSessionsChanged={refreshSessions} />
    </>
  );
}
