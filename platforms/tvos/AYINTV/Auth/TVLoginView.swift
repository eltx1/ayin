import SwiftUI

struct TVLoginView: View {
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
    @FocusState private var focusedField: Field?

    private enum Field {
        case email, password, code, recovery
    }

    var body: some View {
        NavigationStack {
            Form {
                if let challenge = session.mfaChallenge {
                    if challenge.enrollmentRequired {
                        Section("Security setup required") {
                            Text("Finish MFA enrollment on AYIN web, then return to Apple TV.")
                        }
                    } else {
                        Section("Two-factor authentication") {
                            if useRecoveryCode {
                                TextField("Recovery code", text: $recoveryCode)
                                    .focused($focusedField, equals: .recovery)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()

                                Button("Use authenticator code") {
                                    useRecoveryCode = false
                                    errorMessage = nil
                                    focusedField = .code
                                }
                            } else {
                                TextField("6-digit code", text: $code)
                                    .focused($focusedField, equals: .code)
                                    .keyboardType(.numberPad)
                                    .textContentType(.oneTimeCode)

                                Button("Use recovery code") {
                                    useRecoveryCode = true
                                    errorMessage = nil
                                    focusedField = .recovery
                                }
                            }

                            Button("Verify") { startMFA() }
                                .disabled(!mfaInputValid || isSubmitting)
                        }
                    }
                } else {
                    Section("AYIN account") {
                        TextField("Email", text: $email)
                            .focused($focusedField, equals: .email)
                            .textInputAutocapitalization(.never)
                            .textContentType(.username)
                            .autocorrectionDisabled()

                        SecureField("Password", text: $password)
                            .focused($focusedField, equals: .password)
                            .textContentType(.password)

                        Button("Sign In") { startLogin() }
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
            .navigationTitle("Sign In")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        cancelSubmission()
                        session.cancelMFA()
                        dismiss()
                    }
                }
            }
            .onAppear {
                focusedField = session.mfaChallenge == nil ? .email : .code
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
        useRecoveryCode
            ? recoveryCode.trimmingCharacters(in: .whitespacesAndNewlines).count >= 16
            : code.count == 6
    }

    private func startLogin() {
        submissionTask?.cancel()
        submissionTask = Task { @MainActor in
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
    }

    private func startMFA() {
        submissionTask?.cancel()
        submissionTask = Task { @MainActor in
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

    private func cancelSubmission() {
        submissionTask?.cancel()
        submissionTask = nil
        isSubmitting = false
    }
}
