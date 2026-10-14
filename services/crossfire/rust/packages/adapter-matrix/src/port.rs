use crate::account::Authority;
use crossfire_domain::matrix::{
    Account, MatrixAuthority, MatrixEvent, RoomAccess, RoomAdmission, RoomFacts, RoomInvitation,
    RoomMembership,
};
use crossfire_kernel::{Result, secret::Secret};

impl MatrixAuthority for Authority {
    async fn exists(&self, user: &str) -> Result<bool> {
        self.exists(user).await
    }
    async fn provision(&self, user: &str, password: &Secret, device: &str) -> Result<Account> {
        self.provision(user, password, device).await
    }
    async fn deactivate(&self, user: &str) -> Result<()> {
        self.deactivate(user).await
    }
    async fn discard(&self, user: &str) -> Result<()> {
        self.discard(user).await
    }
    async fn profile_name(&self, user: &str) -> Result<Option<String>> {
        self.profile_name(user).await
    }
    async fn set_display_name(&self, user: &str, name: &str) -> Result<()> {
        self.set_display_name(user, name).await
    }
    async fn joined(&self, user: &str) -> Result<Vec<String>> {
        self.joined(user).await
    }
    async fn owner_conversation(
        &self,
        owner: &str,
        agent: &str,
        selected: Option<&str>,
        previous_name: Option<&str>,
    ) -> Result<String> {
        self.owner_conversation(owner, agent, selected, previous_name)
            .await
    }
    async fn verify_owner_conversation(&self, owner: &str, agent: &str, room: &str) -> Result<()> {
        self.verify_owner_conversation(owner, agent, room).await
    }
    async fn mark_direct(&self, user: &str, counterpart: &str, room: &str) -> Result<()> {
        self.mark_direct(user, counterpart, room).await
    }
    async fn room(&self, user: &str, room: &str) -> Result<RoomFacts> {
        self.room(user, room).await
    }
    async fn membership(&self, user: &str, target: &str, room: &str) -> Result<RoomMembership> {
        self.membership(user, target, room).await
    }
    async fn invitation(&self, user: &str, room: &str) -> Result<Option<RoomInvitation>> {
        self.invitation(user, room).await
    }
    async fn set_room_access(
        &self,
        user: &str,
        target: &str,
        room: &str,
        access: RoomAccess,
        admission: Option<&RoomAdmission>,
    ) -> Result<RoomMembership> {
        self.set_room_access(user, target, room, access, admission)
            .await
    }
    async fn leave(&self, user: &str, room: &str) -> Result<()> {
        self.leave(user, room).await
    }
    async fn event(&self, user: &str, room: &str, event: &str) -> Result<MatrixEvent> {
        self.event(user, room, event).await
    }
    async fn send_notice(
        &self,
        user: &str,
        room: &str,
        transaction_id: &str,
        body: &str,
        sender: &str,
    ) -> Result<String> {
        self.send_notice(user, room, transaction_id, body, sender)
            .await
    }
    fn close(&self) {
        self.close();
    }
}
