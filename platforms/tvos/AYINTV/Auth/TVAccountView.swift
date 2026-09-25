import SwiftUI

struct TVAccountView: View {
    @EnvironmentObject private var session: SessionController
    @State private var showingLogin = false

    var body: some View {
        VStack(spacing: 34) {
            if session.isRestoring {
                ProgressView("Restoring AYIN…")
            } else if let identity = session.identity, session.isAuthenticated {
                Image(systemName: "person.crop.circle.fill")
                    .font(.system(size: 96))
                Text(identity.account.displayName)
                    .font(.largeTitle.bold())
                Text(identity.account.email)
                    .foregroundStyle(.secondary)
                Text("@\(identity.channel.handle)")
                    .foregroundStyle(.secondary)

                Button("Sign Out", role: .destructive) {
                    Task { await session.logout() }
                }
            } else {
                Image(systemName: "person.crop.circle")
                    .font(.system(size: 96))
                Text("Sign in to AYIN")
                    .font(.largeTitle.bold())
                Text("Continue Watching, your library, and cross-device progress use your AYIN account.")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 850)

                Button("Sign In") {
                    showingLogin = true
                }
                .buttonStyle(.borderedProminent)

                if session.restoreErrorMessage != nil, session.token != nil {
                    Button("Retry Saved Session") {
                        Task { await session.retryRestore() }
                    }
                }
            }
        }
        .padding(80)
        .navigationTitle("Account")
        .sheet(isPresented: $showingLogin) {
            TVLoginView()
                .environmentObject(session)
        }
    }
}
