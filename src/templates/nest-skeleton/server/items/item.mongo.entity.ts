import { Column, CreateDateColumn, Entity, ObjectId, ObjectIdColumn } from 'typeorm';

// Variante mongo de Item — @ObjectIdColumn en vez de
// @PrimaryGeneratedColumn (mongo usa ObjectId hex). Se registra en
// lugar de Item cuando DB_TYPE=mongodb (database.module.ts).
@Entity()
export class ItemMongo {
  @ObjectIdColumn()
  id: ObjectId;

  @Column()
  name: string;

  @CreateDateColumn()
  createdAt: Date;
}
