import { CommandClient } from 'eris';
import { Collection } from 'mongodb';
import { IDS, UserFlagKeys, UserFlags } from '../constants.js';
import { User } from '../db';
const flagRoles = IDS.flagRoles;

// Give role in server if user has flag in DB
const SYNC_DB_TO_SERVER: (UserFlagKeys | '_')[] = ['CONTRIBUTOR', 'TRANSLATOR', 'TRANSLATOR', 'BUG_HUNTER', 'EARLY_USER', '_'];

// Set role in DB if user has role added/removed in server
const SYNC_SERVER_TO_DB: UserFlagKeys[] = ['CONTRIBUTOR', 'SERVER_BOOSTER', 'TRANSLATOR', 'BUG_HUNTER', 'EARLY_USER'];

// Remove flag from DB when user leaves server
const REMOVE_FLAG_ON_LEAVE: UserFlagKeys[] = ['SERVER_BOOSTER'];


async function upsertUser(collection: Collection<User>, id: string, data: Partial<User>) {
  const res = await collection.findOneAndUpdate(
	  { _id: id },
	  {
      $currentDate: { updatedAt: true },
      $min: { createdAt: new Date() },
      $set: data
	  },
	  { upsert: true, returnDocument: 'after'}
  );
  return res.value!;
}

async function findUser(collection: Collection<User>, id: string) {
  const user = await collection.findOne({ _id: id });
  return user;
}

export default async function (client: CommandClient) {
  const collection = client.mango.collection<User>('users');

  client.on('guildMemberAdd', async (_, member) => {
    const user = await findUser(collection, member.id);
    if (!user) return;
    const rolesToAdd = SYNC_DB_TO_SERVER.filter(x => x === '_' || user.flags & UserFlags[x]);
    rolesToAdd.forEach(role => member.addRole(flagRoles[role]!));
  });

  client.on('guildMemberUpdate', async (_, member) => {
    if (!member) return;
    const user = await findUser(collection, member.id);
    const flagsToAdd = SYNC_SERVER_TO_DB.filter(x => member.roles.includes(flagRoles[x]!)).reduce((acc, cur) => acc | UserFlags[cur], 0);
    const flagsToRemove = SYNC_SERVER_TO_DB.filter(x => !member.roles.includes(flagRoles[x]!)).reduce((acc, cur) => acc | UserFlags[cur], 0);
    if (!user) {
      if (flagsToAdd) await upsertUser(collection, member.id, {
        username: member.username,
        discriminator: member.discriminator,
        avatar: member.avatar,
        flags: flagsToAdd,
      });
      return;
    }
    const newFlags = (user.flags | flagsToAdd) & ~flagsToRemove;
    if (newFlags !== user.flags) upsertUser(collection, member.id, { flags: newFlags });  
  });

  client.on('messageCreate', async ({member}) => {
    if (!member) return;
    const user = await findUser(collection, member.id);
    if (!user) return;
    const rolesToAdd = SYNC_DB_TO_SERVER.filter(x => x === '_' || user.flags & UserFlags[x]);
    rolesToAdd.forEach(role => member.addRole(flagRoles[role]!));
  });

  client.on('guildMemberRemove', async (_, member) => {
    const user = await findUser(collection, member.id);
    if (!user) return;
    const newFlags = user.flags & ~REMOVE_FLAG_ON_LEAVE.reduce((acc, cur) => acc | UserFlags[cur], 0);
    if (newFlags !== user.flags) upsertUser(collection, member.id, { flags: newFlags });
  });
}