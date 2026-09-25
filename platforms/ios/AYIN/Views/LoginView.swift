import SwiftUI

struct LoginView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var session: SessionController

    @State private var email = ""
    @State private var password = ""
    @State private var code = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

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
                            TextField("6-digit code", text: $code)
                                .keyboardType(.numberPad)
                                .textContentType(.oneTimeCode)

                            Button("Verify") {
                                Task { await verifyMFA() }
                            }
                            .disabled(code.count != 6 || isSubmitting)
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
                            Task { await signIn() }
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
                        session.cancelMFA()
                        dismiss()
                    }
                }
            }
            .onChange(of: session.isAuthenticated) { _, authenticated in
                if authenticated { dismiss() }
            }
        }
    }

    private func signIn() async {
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await session.login(email: email, password: password)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func verifyMFA() async {
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await session.completeMFA(code: code)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
