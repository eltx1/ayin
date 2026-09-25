import SwiftUI

struct LoginView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var session: SessionController

    @State private var email = ""
    @State private var password = ""
    @State private var code = ""
    @State private var recoveryCode = ""
    @State private var useRecoveryCode = false
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var submissionTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            Form {
                if let challenge = session.mfaChallenge {
                    if challenge.enrollmentRequired {
                        Section {
                            Text("This account must finish MFA enrollment on AYIN web before native iOS sign-in can continue.")
                        } header: {
                            Text("Security setup required")
                        }
                    } else {
                        Section("Two-factor authentication") {
                            if useRecoveryCode {
                                TextField("Recovery code", text: $recoveryCode)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()

                                Button("Use authenticator code") {
                                    useRecoveryCode = false
                                    errorMessage = nil
                                }
                            } else {
                                TextField("6-digit code", text: $code)
                                    .keyboardType(.numberPad)
                                    .textContentType(.oneTimeCode)

                                Button("Use recovery code") {
                                    useRecoveryCode = true
                                    errorMessage = nil
                                }
                            }

                            Button("Verify") {
                                startMFASubmission()
                            }
                            .disabled(!mfaInputValid || isSubmitting)
                        }
                    }
                } else {
                    Section("AYIN account") {
                        TextField("Email", text: $email)
                            .textInputAutocapitalization(.never)
                            .keyboardType(.emailAddress)
                            .textContentType(.username)
                            .autocorrectionDisabled()

                        SecureField("Password", text: $password)
                            .textContentType(.password)

                        Button("Sign in") {
                            startSignIn()
                        }
                        .disabled(email.isEmpty || password.isEmpty || isSubmitting)
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Sign in")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        cancelSubmission()
                        session.cancelMFA()
                        dismiss()
                    }
                }
            }
            .onChange(of: session.isAuthenticated) { _, authenticated in
                if authenticated {
                    submissionTask = nil
                    dismiss()
                }
            }
            .onDisappear {
                cancelSubmission()
                session.cancelMFA()
            }
        }
    }

    private var mfaInputValid: Bool {
        if useRecoveryCode {
            return recoveryCode.trimmingCharacters(in: .whitespacesAndNewlines).count >= 16
        }
        return code.count == 6
    }

    private func startSignIn() {
        submissionTask?.cancel()
        submissionTask = Task { await signIn() }
    }

    private func startMFASubmission() {
        submissionTask?.cancel()
        submissionTask = Task { await verifyMFA() }
    }

    private func cancelSubmission() {
        submissionTask?.cancel()
        submissionTask = nil
        isSubmitting = false
    }

    private func signIn() async {
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await session.login(email: email, password: password)
            try Task.checkCancellation()
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func verifyMFA() async {
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            if useRecoveryCode {
                try await session.completeMFA(recoveryCode: recoveryCode)
            } else {
                try await session.completeMFA(code: code)
            }
            try Task.checkCancellation()
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
