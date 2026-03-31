const { PermissionsBitField } = require("discord.js");

const OWNER_ROLE_ID = "1113158001604427966";

function hasPermission(member, permissionFlag) {
  return !!member?.permissions?.has?.(permissionFlag);
}

function hasAnyPermission(member, permissionFlags) {
  return permissionFlags.some(flag => hasPermission(member, flag));
}

function hasAnyRole(member, roleIds) {
  return roleIds.filter(Boolean).some(roleId => member?.roles?.cache?.has?.(roleId));
}

function getStaffRoleIds() {
  return [process.env.STAFF_ROLE_ID, process.env.ADMIN_ROLE_ID, OWNER_ROLE_ID];
}

function getAdminRoleIds() {
  return [process.env.ADMIN_ROLE_ID, OWNER_ROLE_ID];
}

function getApproverRoleIds() {
  return [
    ...(process.env.APPROVER_ROLE_IDS || "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean),
    process.env.ADMIN_ROLE_ID,
    OWNER_ROLE_ID
  ];
}

function isServerManager(member) {
  return hasAnyPermission(member, [
    PermissionsBitField.Flags.Administrator,
    PermissionsBitField.Flags.ManageGuild
  ]);
}

function canUseWarn(member) {
  return isServerManager(member) || hasAnyRole(member, getStaffRoleIds());
}

function canUseTimeout(member) {
  return (
    hasAnyPermission(member, [
      PermissionsBitField.Flags.Administrator,
      PermissionsBitField.Flags.ManageGuild,
      PermissionsBitField.Flags.ModerateMembers
    ]) || hasAnyRole(member, getStaffRoleIds())
  );
}

function canUseRequestKick(member) {
  return isServerManager(member) || hasAnyRole(member, getStaffRoleIds());
}

function canUseModInterestPanel(member) {
  return isServerManager(member) || hasAnyRole(member, getApproverRoleIds());
}

function canUseRevokeStrike(member) {
  return isServerManager(member) || hasAnyRole(member, getAdminRoleIds());
}

function canUseKickApproval(member) {
  return isServerManager(member) || hasAnyRole(member, getApproverRoleIds());
}

module.exports = {
  canUseWarn,
  canUseTimeout,
  canUseRequestKick,
  canUseModInterestPanel,
  canUseRevokeStrike,
  canUseKickApproval
};
